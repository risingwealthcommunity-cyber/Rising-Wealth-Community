import { randomUUID } from 'node:crypto';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from './errors/AppError';

/**
 * File storage. When Cloudflare R2 is set up (R2_* in .env) a proof picture is kept in the bucket, and the database holds only a
 * short marker ("r2:<key>") in the same column. With no R2 settings, or under test, the bytes stay in the database as before.
 * A real image can never start with "r2:", so the two cannot be confused.
 */
const MARK = 'r2:';
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const cfg = () => ({
  endpoint: process.env.R2_ENDPOINT?.trim(),
  bucket: process.env.R2_BUCKET?.trim(),
  accessKeyId: process.env.R2_ACCESS_KEY_ID?.trim(),
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim()
});

/** Read on every call, so it does not depend on when .env was loaded. */
export const isR2On = () => {
  const c = cfg();
  return Boolean(c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey) && process.env.NODE_ENV !== 'test';
};

let client: S3Client | null = null;
const s3 = () => {
  const c = cfg();
  return (client ??= new S3Client({ region: 'auto', endpoint: c.endpoint, credentials: { accessKeyId: c.accessKeyId!, secretAccessKey: c.secretAccessKey! } }));
};
const bucketName = () => cfg().bucket;

const PENDING = 'r2pending:';
/** A picture the browser uploaded straight to R2 may be at most this big. */
export const MAX_UPLOAD_BYTES = 2_000_000;
const finalKey = (folder: string, mime: string) => `${folder}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${EXT[mime] ?? 'bin'}`;

/** A one-time address the browser can PUT a picture to. The size and type are part of the signature, so nothing else is accepted. */
export async function signUpload(userId: string, mime: string, size: number): Promise<{ url: string; key: string; expiresIn: number }> {
  const key = `pending/${userId}/${randomUUID()}.${EXT[mime]}`;
  const expiresIn = 300;
  const url = await getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucketName(), Key: key, ContentType: mime, ContentLength: size }), {
    expiresIn,
    signableHeaders: new Set(['content-type', 'content-length'])
  });
  return { url, key, expiresIn };
}

/**
 * Checks a picture the browser uploaded: the key must be in this member's own pending folder, the size must be within the limit and
 * the first bytes must really be a picture. Returns a handle that storeFile then moves to its final place.
 */
export async function claimUpload(userId: string, key: string, sniff: (b: Buffer) => string | null): Promise<{ data: Buffer; mime: string }> {
  if (!isR2On()) throw new AppError('Direct upload is not available.', 400);
  if (!new RegExp(`^pending/${userId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(key)) throw new AppError('That upload is not valid. Please try again.', 400);
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucketName(), Key: key }));
    if ((head.ContentLength ?? 0) > MAX_UPLOAD_BYTES || (head.ContentLength ?? 0) < 100) {
      await s3().send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
      throw new AppError('That picture is too large. Use a smaller screenshot.', 413);
    }
    const first = await s3().send(new GetObjectCommand({ Bucket: bucketName(), Key: key, Range: 'bytes=0-31' }));
    const mime = sniff(Buffer.from(await first.Body!.transformToByteArray()));
    if (!mime) {
      await s3().send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
      throw new AppError('Upload a PNG, JPG or WebP screenshot.', 400);
    }
    return { data: Buffer.from(PENDING + key), mime };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('We could not find that upload. It may have expired, so please upload the picture again.', 400);
  }
}

/** Keeps the picture and returns what goes in the database column: a marker when it is in R2, the bytes themselves when it is not. */
export async function storeFile(data: Buffer, mime: string, folder: string): Promise<Buffer> {
  if (!isR2On()) return data;
  const key = finalKey(folder, mime);
  if (data.length < 300 && data.subarray(0, PENDING.length).toString() === PENDING) {
    // already in R2 (uploaded by the browser): move it out of the pending folder, which also means it can be claimed only once
    const from = data.toString().slice(PENDING.length);
    await s3().send(new CopyObjectCommand({ Bucket: bucketName(), CopySource: `${bucketName()}/${from}`, Key: key, ContentType: mime, MetadataDirective: 'REPLACE' }));
    await s3().send(new DeleteObjectCommand({ Bucket: bucketName(), Key: from }));
    return Buffer.from(MARK + key);
  }
  await s3().send(new PutObjectCommand({ Bucket: bucketName(), Key: key, Body: data, ContentType: mime }));
  return Buffer.from(MARK + key);
}

const isMarker = (b: Uint8Array) => b.length < 200 && Buffer.from(b.subarray(0, MARK.length)).toString() === MARK;

/** The picture's bytes, whether the column holds them or points to R2. */
export async function loadFile(stored: Uint8Array): Promise<Buffer> {
  if (!isMarker(stored)) return Buffer.from(stored);
  const key = Buffer.from(stored).toString().slice(MARK.length);
  const r = await s3().send(new GetObjectCommand({ Bucket: bucketName(), Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

/** True when the column already points to R2. */
export const isStoredInR2 = isMarker;

export async function deleteStored(stored: Uint8Array): Promise<void> {
  if (!isMarker(stored)) return;
  await s3().send(new DeleteObjectCommand({ Bucket: bucketName(), Key: Buffer.from(stored).toString().slice(MARK.length) }));
}
