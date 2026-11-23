import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { validateBody } from '../../shared/middleware/validate.middleware';
import { requireAuth, requireRole } from '../auth';
import { distributeDematReferral, paiseToDecimal } from '../income/income.service';
import { proofFrom } from '../../shared/proof';
import { loadFile, signDownload, storeFile } from '../../shared/storage';

/** Members: see the campaigns, send proof reports and watch them get approved. */
export const campaignRoutes = Router();
/** Admins: manage campaigns and review reports. Mounted under /admin. */
export const campaignAdminRoutes = Router();

// ---------------------------------------------------------------- proof files (screenshots, kept in the database)

const holder = z.string().trim().min(2, 'Enter the account holder name').max(80);
const mobile = z.string().trim().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10 digit mobile number');
const proof = z.object({ fileName: z.string().trim().max(120).default(''), fileData: z.string().min(20).optional(), fileKey: z.string().max(200).optional() });

/** Serialises everything about one (campaign, mobile) pair for the length of a transaction, so checks and writes cannot interleave. */
const lockPair = (tx: Prisma.TransactionClient, campaignId: string, mobile: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${campaignId}:${mobile}`}, 7))`;

// ---------------------------------------------------------------- member side

/** Logos are admin uploads kept as site images named campaign-<id>. */
async function logoMap(): Promise<Map<string, string>> {
  const rows = await prisma.siteAsset.findMany({ where: { key: { startsWith: 'campaign-' } }, select: { key: true, updatedAt: true } });
  return new Map(rows.map((r) => [r.key.slice('campaign-'.length), `/api/site/assets/${r.key}?v=${r.updatedAt.getTime()}`]));
}

const publicCampaign = (c: { id: string; title: string; description: string; reward: unknown; url: string; videoUrl: string; needsProof: boolean; groupName: string; linkType: string; isActive?: boolean; expiredAt?: Date | null }, logo?: string) => ({
  logoUrl: logo ?? null,
  groupName: c.groupName,
  linkType: c.linkType,
  id: c.id,
  title: c.title,
  description: c.description,
  reward: Number(c.reward),
  url: c.url,
  videoUrl: c.videoUrl,
  needsProof: c.needsProof,
  status: c.isActive === false ? 'EXPIRED' : 'LIVE',
  expiredAt: c.expiredAt ?? null
});

campaignRoutes.get('/', requireAuth, async (_req: Request, res: Response) => {
  const [items, logos] = await Promise.all([prisma.campaign.findMany({ where: { OR: [{ isActive: true }, { isActive: false, expiredAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }] }, orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }], take: 200 }), logoMap()]);
  res.json({ success: true, data: { items: items.map((c) => publicCampaign(c, logos.get(c.id))) } });
});

campaignRoutes.get('/stats', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [total, approved, earned] = await Promise.all([
    prisma.campaignReport.count({ where: { userId } }),
    prisma.campaignReport.count({ where: { userId, status: 'APPROVED' } }),
    prisma.ledgerEntry.aggregate({ where: { userId, type: { in: ['CAMPAIGN_REWARD', 'DEMAT_DIRECT'] } }, _sum: { amount: true } })
  ]);
  res.json({ success: true, data: { total, approved, earnings: Number(earned._sum.amount ?? 0) } });
});

const reportView = (r: { id: string; holderName: string; mobile: string; status: string; note: string | null; createdAt: Date; fileMime?: string | null; campaign: { id: string; title: string; reward: unknown } }) => ({
  id: r.id,
  holderName: r.holderName,
  mobile: r.mobile,
  status: r.status,
  note: r.note,
  createdAt: r.createdAt,
  hasFile: Boolean(r.fileMime),
  campaign: { id: r.campaign.id, title: r.campaign.title, reward: Number(r.campaign.reward) }
});

campaignRoutes.get('/reports', requireAuth, async (req: Request, res: Response) => {
  const items = await prisma.campaignReport.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, holderName: true, mobile: true, status: true, note: true, createdAt: true, fileMime: true, campaign: { select: { id: true, title: true, reward: true } } }
  });
  res.json({ success: true, data: { items: items.map(reportView) } });
});

const createSchema = z.object({ campaignId: z.string().uuid(), holderName: holder, mobile, ...proof.shape });

campaignRoutes.post('/reports', requireAuth, validateBody(createSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof createSchema>;
  const campaign = await prisma.campaign.findFirst({ where: { id: body.campaignId, isActive: true } });
  if (!campaign) throw new AppError('That campaign is not open for reports.', 404);

  const pending = await prisma.campaignReport.count({ where: { userId: req.user!.id, status: 'PENDING' } });
  if (pending >= 20) throw new AppError('You have 20 reports waiting. Please wait for them to be checked.', 409);
  const file = body.fileData || body.fileKey ? await proofFrom(req.user!.id, body, true) : null;
  if (campaign.needsProof && !file) throw new AppError('Add the screenshot that proves the account was opened.', 400);
  const stored = file ? await storeFile(file.data, file.mime, 'reports') : null;
  const r = await prisma.$transaction(async (tx) => {
    await lockPair(tx, campaign.id, body.mobile);
    const dup = await tx.campaignReport.findFirst({
      where: { campaignId: campaign.id, mobile: body.mobile, status: { in: ['PENDING', 'APPROVED', 'INCOMPLETE'] } }
    });
    if (dup) throw new AppError('A report for this mobile number already exists for this campaign.', 409);
    return tx.campaignReport.create({
      data: {
        userId: req.user!.id,
        campaignId: campaign.id,
        holderName: body.holderName,
        mobile: body.mobile,
        fileName: file ? body.fileName : null,
        fileMime: file ? file.mime : null,
        fileData: stored
      }
    });
  });
  res.status(201).json({ success: true, message: 'Report submitted. It is checked by our team.', data: { id: r.id } });
});

const editSchema = z.object({ holderName: holder, mobile, fileName: z.string().trim().max(120).optional(), fileData: z.string().min(20).optional(), fileKey: z.string().max(200).optional() });

campaignRoutes.put('/reports/:id', requireAuth, validateBody(editSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof editSchema>;
  const id = String(req.params.id);
  const existing = await prisma.campaignReport.findFirst({ where: { id, userId: req.user!.id } });
  if (!existing) throw new AppError('Report not found', 404);

  const file = body.fileData || body.fileKey ? await proofFrom(req.user!.id, body, true) : null;
  const storedEdit = file ? await storeFile(file.data, file.mime, 'reports') : null;
  const dup = await prisma.campaignReport.findFirst({
    where: { id: { not: id }, campaignId: existing.campaignId, mobile: body.mobile, status: { in: ['PENDING', 'APPROVED', 'INCOMPLETE'] } }
  });
  if (dup) throw new AppError('A report for this mobile number already exists for this campaign.', 409);

  // only while it is waiting or was sent back as incomplete (fixing it puts it back in the queue); the rest is a record
  const done = await prisma.campaignReport.updateMany({
    where: { id, userId: req.user!.id, status: { in: ['PENDING', 'INCOMPLETE'] } },
    data: {
      status: 'PENDING',
      note: null,
      holderName: body.holderName,
      mobile: body.mobile,
      ...(file && storedEdit ? { fileData: storedEdit, fileMime: file.mime, fileName: body.fileName || existing.fileName } : {})
    }
  });
  if (done.count !== 1) throw new AppError('Only a report that is still waiting can be changed.', 409);
  res.json({ success: true, message: 'Report updated.' });
});

campaignRoutes.delete('/reports/:id', requireAuth, async (req: Request, res: Response) => {
  const done = await prisma.campaignReport.deleteMany({ where: { id: String(req.params.id), userId: req.user!.id, status: { in: ['PENDING', 'INCOMPLETE'] } } });
  if (done.count !== 1) throw new AppError('Only a report that is still waiting can be deleted.', 409);
  res.json({ success: true, message: 'Report deleted.' });
});

/** The proof picture, as base64. Only its owner or an admin can read it. */
campaignRoutes.get('/reports/:id/file', requireAuth, async (req: Request, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN' || req.user!.role === 'SUPER_ADMIN';
  const r = await prisma.campaignReport.findFirst({
    where: { id: String(req.params.id), ...(isAdmin ? {} : { userId: req.user!.id }) },
    select: { fileData: true, fileMime: true }
  });
  if (!r) throw new AppError('Report not found', 404);
  if (!r.fileData || !r.fileMime) throw new AppError('This report has no screenshot.', 404);
  if (r.fileMime.startsWith('video/')) {
    const url = await signDownload(r.fileData);
    if (!url) throw new AppError('This video is not available.', 404);
    res.json({ success: true, data: { mime: r.fileMime, url } });
    return;
  }
  res.json({ success: true, data: { mime: r.fileMime, data: (await loadFile(r.fileData)).toString('base64') } });
});

// ---------------------------------------------------------------- admin side

campaignAdminRoutes.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

const https = z.string().trim().max(300).refine((v) => v === '' || /^https:\/\/\S+$/i.test(v), 'The link must start with https:// (for example https://example.com/offer)');
const campaignSchema = z.object({
  title: z.string().trim().min(2, 'Write the campaign name (at least 2 letters)').max(80, 'The campaign name can be at most 80 characters'),
  description: z.string().trim().max(300, 'The description can be at most 300 characters').default(''),
  reward: z.number().min(0).max(1_000_000),
  groupName: z.string().trim().max(60).default(''),
  url: https.default(''),
  linkType: z.enum(['STANDARD', 'PERSONAL']).default('STANDARD'),
  videoUrl: https.default(''),
  needsProof: z.boolean().default(true),
  isDemat: z.boolean().default(false),
  isActive: z.boolean().default(true)
});

const adminCampaign = (c: { id: string; title: string; description: string; reward: unknown; url: string; videoUrl: string; needsProof: boolean; isActive: boolean; isDemat: boolean; groupName: string; linkType: string; expiredAt?: Date | null }, logo?: string) => ({
  ...publicCampaign(c, logo),
  isActive: c.isActive,
  isDemat: c.isDemat
});

campaignAdminRoutes.get('/campaigns', async (_req: Request, res: Response) => {
  const [items, logos] = await Promise.all([prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } }), logoMap()]);
  res.json({ success: true, data: { items: items.map((c) => adminCampaign(c, logos.get(c.id))) } });
});

campaignAdminRoutes.post('/campaigns', validateBody(campaignSchema), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof campaignSchema>;
  const c = await prisma.campaign.create({ data: { ...b, expiredAt: b.isActive ? null : new Date(), reward: paiseToDecimal(Math.round(b.reward * 100)) } });
  res.status(201).json({ success: true, message: 'Campaign created', data: adminCampaign(c) });
});

campaignAdminRoutes.put('/campaigns/:id', validateBody(campaignSchema), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof campaignSchema>;
  const done = await prisma.campaign.updateMany({ where: { id: String(req.params.id) }, data: { ...b, ...(b.isActive ? { expiredAt: null } : {}), reward: paiseToDecimal(Math.round(b.reward * 100)) } });
  if (done.count !== 1) throw new AppError('Campaign not found', 404);
  if (!b.isActive) await prisma.campaign.updateMany({ where: { id: String(req.params.id), isActive: false, expiredAt: null }, data: { expiredAt: new Date() } });
  res.json({ success: true, message: 'Campaign saved' });
});

/** Make a campaign Live again, or Expire it (members then see it marked Expired and can no longer send reports). */
campaignAdminRoutes.post('/campaigns/:id/status', validateBody(z.object({ status: z.enum(['LIVE', 'EXPIRED']) })), async (req: Request, res: Response) => {
  const live = req.body.status === 'LIVE';
  const done = await prisma.campaign.updateMany({ where: { id: String(req.params.id) }, data: { isActive: live, expiredAt: live ? null : new Date() } });
  if (done.count !== 1) throw new AppError('Campaign not found', 404);
  res.json({ success: true, message: live ? 'Campaign is Live.' : 'Campaign expired.' });
});

campaignAdminRoutes.delete('/campaigns/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if ((await prisma.campaignReport.count({ where: { campaignId: id } })) > 0) {
    // reports exist: keep the history, just stop showing it
    await prisma.campaign.updateMany({ where: { id }, data: { isActive: false } });
    res.json({ success: true, message: 'Campaign has reports, so it was switched off instead of deleted.' });
    return;
  }
  await prisma.campaign.deleteMany({ where: { id } });
  await prisma.siteAsset.deleteMany({ where: { key: `campaign-${id}` } }); // its logo
  res.json({ success: true, message: 'Campaign deleted' });
});

const STATES = ['PENDING', 'APPROVED', 'REJECTED', 'INCOMPLETE', 'MISSING', 'ALREADY_EXISTING'] as const;
const statusOf = (v: unknown) => z.enum(STATES).catch('PENDING').parse(v);

/** ?status= a state or ALL, ?campaignId=, ?q= (member, account holder, mobile or Affiliate ID). Newest first. */
campaignAdminRoutes.get('/reports', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const campaignId = typeof req.query.campaignId === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.campaignId) ? req.query.campaignId : undefined;
  const items = await prisma.campaignReport.findMany({
    where: {
      ...(req.query.status === 'ALL' ? {} : { status: statusOf(req.query.status) }),
      ...(campaignId ? { campaignId } : {}),
      ...(q
        ? {
            OR: [
              { holderName: { contains: q, mode: 'insensitive' } },
              { mobile: { contains: q } },
              { user: { name: { contains: q, mode: 'insensitive' } } },
              { user: { email: { contains: q, mode: 'insensitive' } } },
              { user: { referralCode: { equals: q.toUpperCase() } } }
            ]
          }
        : {})
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true, holderName: true, mobile: true, status: true, note: true, createdAt: true, processedAt: true, fileName: true, fileMime: true,
      campaign: { select: { id: true, title: true, reward: true } },
      user: { select: { id: true, name: true, email: true, referralCode: true } }
    }
  });
  res.json({ success: true, data: { items: items.map((r) => ({ ...reportView(r), fileName: r.fileName, processedAt: r.processedAt, user: r.user })) } });
});

campaignAdminRoutes.post('/reports/:id/approve', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    const r = await tx.campaignReport.findUnique({ where: { id }, include: { campaign: true } });
    if (!r) throw new AppError('Report not found', 404);
    if (r.userId === req.user!.id) throw new AppError('You cannot approve your own report. Ask another admin.', 403);
    await lockPair(tx, r.campaignId, r.mobile); // two approvals of the same mobile can never both pass the check below
    const rewarded = await tx.campaignReport.findFirst({ where: { campaignId: r.campaignId, mobile: r.mobile, status: 'APPROVED', id: { not: id } } });
    if (rewarded) throw new AppError('This mobile number was already rewarded for this campaign.', 409);

    const claimed = await tx.campaignReport.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', processedAt: new Date(), processedBy: req.user!.id } });
    if (claimed.count !== 1) throw new AppError('Report already processed', 409);

    if (r.campaign.reward.gt(0)) {
      if (r.campaign.isDemat) {
        // a Demat account opening: the member gets the Demat direct income and 5 sponsor levels earn their passive share
        const referrer = await tx.user.findUniqueOrThrow({ where: { id: r.userId }, select: { sponsorId: true } });
        await tx.dematReferral.create({
          data: { referrerId: r.userId, clientName: r.holderName, directAmount: r.campaign.reward, note: `Campaign: ${r.campaign.title}`, createdBy: req.user!.id }
        });
        await distributeDematReferral(tx, {
          referrerId: r.userId,
          sponsorId: referrer.sponsorId,
          directPaise: Math.round(Number(r.campaign.reward) * 100),
          note: `Demat: ${r.holderName}`
        });
      } else {
        // an ordinary campaign: the member gets the reward, and 5 sponsor levels above them earn a passive share of it (9/5/3/2/1%)
        const reporter = await tx.user.findUniqueOrThrow({ where: { id: r.userId }, select: { sponsorId: true } });
        await distributeDematReferral(tx, {
          referrerId: r.userId,
          sponsorId: reporter.sponsorId,
          directPaise: Math.round(Number(r.campaign.reward) * 100),
          directType: 'CAMPAIGN_REWARD',
          note: `Campaign: ${r.campaign.title}`
        });
      }
    }
  });
  res.json({ success: true, message: 'Approved and the reward was added to the wallet.' });
});

const markSchema = z.object({ status: z.enum(['REJECTED', 'INCOMPLETE', 'MISSING', 'ALREADY_EXISTING']), note: z.string().trim().max(200).optional() });

/**
 * The review decisions that pay nothing: Reject, Incomplete (the member can fix and resend), Missing (account not found),
 * Already existing (that account was registered before). Only for a report that is waiting.
 */
campaignAdminRoutes.post('/reports/:id/mark', validateBody(markSchema), async (req: Request, res: Response) => {
  const { status, note } = req.body as z.infer<typeof markSchema>;
  const done = await prisma.campaignReport.updateMany({
    where: { id: String(req.params.id), status: 'PENDING' },
    data: { status, processedAt: new Date(), processedBy: req.user!.id, note: note || null }
  });
  if (done.count !== 1) throw new AppError('Report not found or already processed', 409);
  res.json({ success: true, message: 'Saved' });
});

campaignAdminRoutes.post('/reports/:id/reject', async (req: Request, res: Response) => {
  const note = z.object({ note: z.string().trim().max(200).optional() }).catch({}).parse(req.body ?? {}).note;
  const done = await prisma.campaignReport.updateMany({
    where: { id: String(req.params.id), status: 'PENDING' },
    data: { status: 'REJECTED', processedAt: new Date(), processedBy: req.user!.id, note: note || null }
  });
  if (done.count !== 1) throw new AppError('Report not found or already processed', 409);
  res.json({ success: true, message: 'Report rejected' });
});
