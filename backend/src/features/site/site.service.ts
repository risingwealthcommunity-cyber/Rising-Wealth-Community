import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { SETTING_SCHEMAS } from './site.validator';
import type { SettingName } from './site.validator';

/**
 * Admin-managed images. Fixed slots (About photo, certificate, feature and milestone
 * backgrounds) plus one slot per team member / review, keyed by that item's id.
 */
export const ASSET_KEY_PATTERN =
  /^(about-image|certificate|payment-qr|login-poster|avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|campaign-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|live-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|feature-[1-6]|milestone-[1-6]|team-[a-f0-9]{10}|review-[a-f0-9]{10})$/;

export const MAX_ASSET_BYTES = 6 * 1024 * 1024;
export const ASSET_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const parseKey = (raw: unknown): string => {
  if (typeof raw === 'string' && ASSET_KEY_PATTERN.test(raw)) return raw;
  throw new AppError('Unknown image', 404);
};

export const parseSettingName = (raw: unknown): SettingName => {
  if (typeof raw === 'string' && Object.hasOwn(SETTING_SCHEMAS, raw)) return raw as SettingName;
  throw new AppError('Unknown content block', 404);
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

interface WithId {
  id?: string;
}
const newId = () => randomBytes(5).toString('hex');
const assetUrl = (key: string, updatedAt: Date) => `/api/site/assets/${key}?v=${updatedAt.getTime()}`;

async function readSetting<T>(name: SettingName): Promise<T | null> {
  const row = await prisma.siteSetting.findUnique({ where: { key: name } });
  return (row?.value as T | undefined) ?? null;
}

export const siteService = {
  /** Which images exist (metadata only, never the bytes). */
  async list() {
    const rows = await prisma.siteAsset.findMany({ select: { key: true, updatedAt: true } });
    return Object.fromEntries(
      rows.map((r) => [r.key, { url: assetUrl(r.key, r.updatedAt), updatedAt: r.updatedAt.toISOString() }])
    );
  },

  /** Everything the public home page needs in one request. */
  async getContent() {
    const [assets, rows] = await Promise.all([this.list(), prisma.siteSetting.findMany()]);
    const val = (k: SettingName) => rows.find((r) => r.key === k)?.value ?? null;
    return {
      assets,
      milestones: val('milestones'),
      team: val('team'),
      reviews: val('reviews'),
      contact: val('contact'),
      pageText: val('pageText'),
      loginPopup: val('loginPopup')
    };
  },

  /** Replace one content block. Team/review items get stable ids, and orphaned photos are removed. */
  async saveSetting(name: SettingName, body: { items?: (WithId & Record<string, unknown>)[] } & Record<string, unknown>) {
    let value: Prisma.InputJsonValue;

    if (name === 'team' || name === 'reviews') {
      const prefix = name === 'team' ? 'team' : 'review';
      const existing = new Set((await readSetting<WithId[]>(name))?.map((i) => i.id) ?? []);
      const items = (body.items ?? []).map((item) => ({
        ...item,
        // Only ids we already issued are kept; anything else gets a fresh one.
        id: item.id && existing.has(item.id) ? item.id : newId()
      }));
      value = items as unknown as Prisma.InputJsonValue;
      await prisma.siteSetting.upsert({ where: { key: name }, create: { key: name, value }, update: { value } });

      const keep = items.map((i) => `${prefix}-${i.id}`);
      await prisma.siteAsset.deleteMany({ where: { key: { startsWith: `${prefix}-`, notIn: keep } } });
    } else if (name === 'training') {
      value = (body.items ?? []) as unknown as Prisma.InputJsonValue;
      await prisma.siteSetting.upsert({ where: { key: name }, create: { key: name, value }, update: { value } });
      return { items: value };
    } else if (name === 'milestones') {
      const items = body.items ?? [];
      value = items as unknown as Prisma.InputJsonValue;
      await prisma.siteSetting.upsert({ where: { key: name }, create: { key: name, value }, update: { value } });
      const drop = [1, 2, 3, 4, 5, 6].filter((n) => n > items.length).map((n) => `milestone-${n}`);
      await prisma.siteAsset.deleteMany({ where: { key: { in: drop } } });
    } else {
      value = body as unknown as Prisma.InputJsonValue;
      await prisma.siteSetting.upsert({ where: { key: name }, create: { key: name, value }, update: { value } });
    }
    return this.getContent();
  },

  /** How members pay: the QR image and the details printed next to it. For signed-in members only. */
  async getPayment() {
    const [details, qr] = await Promise.all([
      readSetting<{ upiId?: string; payeeName?: string; note?: string }>('payment'),
      prisma.siteAsset.findUnique({ where: { key: 'payment-qr' }, select: { updatedAt: true } })
    ]);
    return {
      upiId: details?.upiId ?? '',
      payeeName: details?.payeeName ?? '',
      note: details?.note ?? '',
      qrUrl: qr ? assetUrl('payment-qr', qr.updatedAt) : null
    };
  },

  /** Training lessons are for signed-in members only, so they are not part of the public home page content. */
  async getTraining() {
    return (await readSetting<unknown[]>('training')) ?? [];
  },

  /** Lessons as one member may see them: each carries `unlocked`, and the link only when it is unlocked. Admins see all. */
  async getTrainingFor(pkg: 'TRAINEE' | 'PRO' | 'ELITE', isAdmin: boolean) {
    const rank = { TRAINEE: 0, PRO: 1, ELITE: 2 } as const;
    const lessons = ((await readSetting<{ title: string; description: string; url: string; tier?: keyof typeof rank }[]>('training')) ?? []);
    return lessons.map((l) => {
      const tier = l.tier && l.tier in rank ? l.tier : 'TRAINEE';
      const unlocked = isAdmin || rank[pkg] >= rank[tier];
      return unlocked
        ? { title: l.title, description: l.description, url: l.url, tier, unlocked: true }
        : { title: l.title, description: l.description, tier, unlocked: false };
    });
  },

  async get(key: string) {
    const row = await prisma.siteAsset.findUnique({ where: { key } });
    if (!row) throw new AppError('Image not found', 404);
    return row;
  },

  /** A team/review photo can only be uploaded for an item that has been saved. */
  async assertSlotExists(key: string) {
    const m = /^(team|review)-([a-f0-9]{10})$/.exec(key);
    if (!m) return;
    const items = await readSetting<WithId[]>(m[1] === 'team' ? 'team' : 'reviews');
    if (!items?.some((i) => i.id === m[2])) throw new AppError('Save the item first, then add its photo', 404);
  },

  async save(key: string, body: unknown) {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AppError('Send the image file as PNG, JPEG or WebP', 415);
    }
    if (body.length > MAX_ASSET_BYTES) throw new AppError('Image is too large (max 6 MB)', 413);
    const mime = sniffImageMime(body);
    if (!mime) throw new AppError('File is not a valid PNG, JPEG or WebP image', 415);
    await this.assertSlotExists(key);

    const data = Buffer.from(body);
    const row = await prisma.siteAsset.upsert({
      where: { key },
      create: { key, mime, data },
      update: { mime, data },
      select: { key: true, updatedAt: true }
    });
    return { url: assetUrl(row.key, row.updatedAt), updatedAt: row.updatedAt.toISOString() };
  },

  async remove(key: string) {
    await prisma.siteAsset.deleteMany({ where: { key } });
  }
};
