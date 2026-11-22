import { AppError } from './errors/AppError';
import { claimUpload } from './storage';

/** A photo compressed in the browser fits well under this (the global JSON body limit is 1 MB). */
const MAX_BASE64 = 900_000;

/** The first bytes of the file must really be the image type it claims to be. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

/** A proof picture (payment or report screenshot) sent as base64: size-limited and checked by its real bytes. */
export function readProof(base64: string): { data: Buffer; mime: string } {
  if (base64.length > MAX_BASE64) throw new AppError('That picture is too large. Use a smaller screenshot.', 413);
  const data = Buffer.from(base64, 'base64');
  const mime = sniffImage(data);
  if (!mime) throw new AppError('Upload a PNG, JPG or WebP screenshot.', 400);
  return { data, mime };
}

/** A proof picture from a request body: uploaded straight to storage (fileKey) or sent as base64 (fileData). */
export async function proofFrom(userId: string, body: { fileData?: string; fileKey?: string }): Promise<{ data: Buffer; mime: string }> {
  if (body.fileKey) return claimUpload(userId, body.fileKey, sniffImage);
  if (body.fileData) return readProof(body.fileData);
  throw new AppError('Add the screenshot of the payment.', 400);
}
