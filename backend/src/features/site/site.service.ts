import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';

/** The only admin-managed images. Anything else is a 404. */
export const ASSET_KEYS = ['about-image', 'certificate'] as const;
export type AssetKey = (typeof ASSET_KEYS)[number];

export const MAX_ASSET_BYTES = 6 * 1024 * 1024;
export const ASSET_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const parseKey = (raw: unknown): AssetKey => {
  if (typeof raw === 'string' && (ASSET_KEYS as readonly string[]).includes(raw)) return raw as AssetKey;
  throw new AppError('Unknown image', 404);
};

/**
 * Trust the file's own bytes, not the Content-Type header. Only raster images are accepted
 * (no SVG), so a stored file can never run script when it is opened.
 */
export const sniffImageMime = (buf: Buffer): string | null => {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
};

export const siteService = {
  /** Which images exist (metadata only, never the bytes). */
  async list() {
    const rows = await prisma.siteAsset.findMany({ select: { key: true, updatedAt: true } });
    return Object.fromEntries(
      rows.map((r) => [
        r.key,
        { url: `/api/site/assets/${r.key}?v=${r.updatedAt.getTime()}`, updatedAt: r.updatedAt.toISOString() }
      ])
    );
  },

  async get(key: AssetKey) {
    const row = await prisma.siteAsset.findUnique({ where: { key } });
    if (!row) throw new AppError('Image not found', 404);
    return row;
  },

  async save(key: AssetKey, body: unknown) {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AppError('Send the image file as PNG, JPEG or WebP', 415);
    }
    if (body.length > MAX_ASSET_BYTES) throw new AppError('Image is too large (max 6 MB)', 413);
    const mime = sniffImageMime(body);
    if (!mime) throw new AppError('File is not a valid PNG, JPEG or WebP image', 415);

    const data = Buffer.from(body);
    const row = await prisma.siteAsset.upsert({
      where: { key },
      create: { key, mime, data },
      update: { mime, data },
      select: { key: true, updatedAt: true }
    });
    return { url: `/api/site/assets/${row.key}?v=${row.updatedAt.getTime()}`, updatedAt: row.updatedAt.toISOString() };
  },

  async remove(key: AssetKey) {
    await prisma.siteAsset.deleteMany({ where: { key } });
  }
};
