import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

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

/** Keeps the picture and returns what goes in the database column: a marker when it is in R2, the bytes themselves when it is not. */
export async function storeFile(data: Buffer, mime: string, folder: string): Promise<Buffer> {
  if (!isR2On()) return data;
  const key = `${folder}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${EXT[mime] ?? 'bin'}`;
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
