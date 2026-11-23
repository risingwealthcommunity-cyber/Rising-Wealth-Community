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

/** Also knows video: mp4 and mov start with "ftyp" at byte 4, webm with the EBML header. */
export function sniffMedia(buf: Buffer): string | null {
  const img = sniffImage(buf);
  if (img) return img;
  if (buf.length > 12 && buf.subarray(4, 8).toString() === 'ftyp') {
    const brand = buf.subarray(8, 12).toString();
    return brand === 'qt  ' ? 'video/quicktime' : brand.startsWith('3g') ? 'video/3gpp' : 'video/mp4'; // mp4, m4v, mov, 3gp
  }
  if (buf.length > 12 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm'; // webm and mkv
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'AVI ') return 'video/x-msvideo';
  if (buf.length > 16 && buf.subarray(0, 8).equals(Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]))) return 'video/x-ms-wmv';
  if (buf.length > 12 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && (buf[3] === 0xba || buf[3] === 0xb3)) return 'video/mpeg';
  if (buf.length > 12 && buf.subarray(0, 3).toString() === 'FLV' && buf[3] === 1) return 'video/x-flv';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'OggS') return 'video/ogg';
  return null;
}

/** A proof picture from a request body: uploaded straight to storage (fileKey) or sent as base64 (fileData). */
export async function proofFrom(userId: string, body: { fileData?: string; fileKey?: string }, allowVideo = false): Promise<{ data: Buffer; mime: string }> {
  if (body.fileKey) return claimUpload(userId, body.fileKey, allowVideo ? sniffMedia : sniffImage);
  if (body.fileData) return readProof(body.fileData);
  throw new AppError('Add the screenshot of the payment.', 400);
}
