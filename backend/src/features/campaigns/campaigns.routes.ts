import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { validateBody } from '../../shared/middleware/validate.middleware';
import { requireAuth, requireRole } from '../auth';
import { distributeDematReferral, paiseToDecimal } from '../income/income.service';
import { readProof } from '../../shared/proof';

/** Members: see the campaigns, send proof reports and watch them get approved. */
export const campaignRoutes = Router();
/** Admins: manage campaigns and review reports. Mounted under /admin. */
export const campaignAdminRoutes = Router();

// ---------------------------------------------------------------- proof files (screenshots, kept in the database)

const holder = z.string().trim().min(2, 'Enter the account holder name').max(80);
const mobile = z.string().trim().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10 digit mobile number');
const proof = z.object({ fileName: z.string().trim().max(120), fileData: z.string().min(20) });

// ---------------------------------------------------------------- member side

const publicCampaign = (c: { id: string; title: string; description: string; reward: unknown; url: string; videoUrl: string; needsProof: boolean }) => ({
  id: c.id,
  title: c.title,
  description: c.description,
  reward: Number(c.reward),
  url: c.url,
  videoUrl: c.videoUrl,
  needsProof: c.needsProof
});

campaignRoutes.get('/', requireAuth, async (_req: Request, res: Response) => {
  const items = await prisma.campaign.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' } });
  res.json({ success: true, data: { items: items.map(publicCampaign) } });
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

const reportView = (r: { id: string; holderName: string; mobile: string; status: string; note: string | null; createdAt: Date; campaign: { id: string; title: string; reward: unknown } }) => ({
  id: r.id,
  holderName: r.holderName,
  mobile: r.mobile,
  status: r.status,
  note: r.note,
  createdAt: r.createdAt,
  campaign: { id: r.campaign.id, title: r.campaign.title, reward: Number(r.campaign.reward) }
});

campaignRoutes.get('/reports', requireAuth, async (req: Request, res: Response) => {
  const items = await prisma.campaignReport.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, holderName: true, mobile: true, status: true, note: true, createdAt: true, campaign: { select: { id: true, title: true, reward: true } } }
  });
  res.json({ success: true, data: { items: items.map(reportView) } });
});

const createSchema = z.object({ campaignId: z.string().uuid(), holderName: holder, mobile, ...proof.shape });

campaignRoutes.post('/reports', requireAuth, validateBody(createSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof createSchema>;
  const campaign = await prisma.campaign.findFirst({ where: { id: body.campaignId, isActive: true, needsProof: true } });
  if (!campaign) throw new AppError('That campaign is not open for reports.', 404);

  const pending = await prisma.campaignReport.count({ where: { userId: req.user!.id, status: 'PENDING' } });
  if (pending >= 20) throw new AppError('You have 20 reports waiting. Please wait for them to be checked.', 409);
  const dup = await prisma.campaignReport.findFirst({
    where: { campaignId: campaign.id, mobile: body.mobile, status: { in: ['PENDING', 'APPROVED'] } }
  });
  if (dup) throw new AppError('A report for this mobile number already exists for this campaign.', 409);

  const file = readProof(body.fileData);
  const r = await prisma.campaignReport.create({
    data: {
      userId: req.user!.id,
      campaignId: campaign.id,
      holderName: body.holderName,
      mobile: body.mobile,
      fileName: body.fileName,
      fileMime: file.mime,
      fileData: file.data
    }
  });
  res.status(201).json({ success: true, message: 'Report submitted. It is checked by our team.', data: { id: r.id } });
});

const editSchema = z.object({ holderName: holder, mobile, fileName: z.string().trim().max(120).optional(), fileData: z.string().min(20).optional() });

campaignRoutes.put('/reports/:id', requireAuth, validateBody(editSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof editSchema>;
  const id = String(req.params.id);
  const existing = await prisma.campaignReport.findFirst({ where: { id, userId: req.user!.id } });
  if (!existing) throw new AppError('Report not found', 404);

  const file = body.fileData ? readProof(body.fileData) : null;
  const dup = await prisma.campaignReport.findFirst({
    where: { id: { not: id }, campaignId: existing.campaignId, mobile: body.mobile, status: { in: ['PENDING', 'APPROVED'] } }
  });
  if (dup) throw new AppError('A report for this mobile number already exists for this campaign.', 409);

  // only while it is still waiting: an approved or rejected report is a record
  const done = await prisma.campaignReport.updateMany({
    where: { id, userId: req.user!.id, status: 'PENDING' },
    data: {
      holderName: body.holderName,
      mobile: body.mobile,
      ...(file ? { fileData: file.data, fileMime: file.mime, fileName: body.fileName || existing.fileName } : {})
    }
  });
  if (done.count !== 1) throw new AppError('Only a report that is still waiting can be changed.', 409);
  res.json({ success: true, message: 'Report updated.' });
});

campaignRoutes.delete('/reports/:id', requireAuth, async (req: Request, res: Response) => {
  const done = await prisma.campaignReport.deleteMany({ where: { id: String(req.params.id), userId: req.user!.id, status: 'PENDING' } });
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
  res.json({ success: true, data: { mime: r.fileMime, data: Buffer.from(r.fileData).toString('base64') } });
});

// ---------------------------------------------------------------- admin side

campaignAdminRoutes.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

const https = z.string().trim().max(300).refine((v) => v === '' || /^https:\/\/\S+$/i.test(v), 'Links must start with https://');
const campaignSchema = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(''),
  reward: z.number().min(0).max(1_000_000),
  url: https.refine((v) => v !== '', 'Add the link members will share'),
  videoUrl: https.default(''),
  needsProof: z.boolean().default(true),
  isDemat: z.boolean().default(false),
  isActive: z.boolean().default(true)
});

const adminCampaign = (c: { id: string; title: string; description: string; reward: unknown; url: string; videoUrl: string; needsProof: boolean; isActive: boolean; isDemat: boolean }) => ({
  ...publicCampaign(c),
  isActive: c.isActive,
  isDemat: c.isDemat
});

campaignAdminRoutes.get('/campaigns', async (_req: Request, res: Response) => {
  const items = await prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ success: true, data: { items: items.map(adminCampaign) } });
});

campaignAdminRoutes.post('/campaigns', validateBody(campaignSchema), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof campaignSchema>;
  const c = await prisma.campaign.create({ data: { ...b, reward: paiseToDecimal(Math.round(b.reward * 100)) } });
  res.status(201).json({ success: true, message: 'Campaign created', data: adminCampaign(c) });
});

campaignAdminRoutes.put('/campaigns/:id', validateBody(campaignSchema), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof campaignSchema>;
  const done = await prisma.campaign.updateMany({ where: { id: String(req.params.id) }, data: { ...b, reward: paiseToDecimal(Math.round(b.reward * 100)) } });
  if (done.count !== 1) throw new AppError('Campaign not found', 404);
  res.json({ success: true, message: 'Campaign saved' });
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
  res.json({ success: true, message: 'Campaign deleted' });
});

const statusOf = (v: unknown) => z.enum(['PENDING', 'APPROVED', 'REJECTED']).catch('PENDING').parse(v);

campaignAdminRoutes.get('/reports', async (req: Request, res: Response) => {
  const items = await prisma.campaignReport.findMany({
    where: { status: statusOf(req.query.status) },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, holderName: true, mobile: true, status: true, note: true, createdAt: true, fileName: true,
      campaign: { select: { id: true, title: true, reward: true } },
      user: { select: { id: true, name: true, email: true, referralCode: true } }
    }
  });
  res.json({ success: true, data: { items: items.map((r) => ({ ...reportView(r), fileName: r.fileName, user: r.user })) } });
});

campaignAdminRoutes.post('/reports/:id/approve', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    const r = await tx.campaignReport.findUnique({ where: { id }, include: { campaign: true } });
    if (!r) throw new AppError('Report not found', 404);
    if (r.userId === req.user!.id) throw new AppError('You cannot approve your own report. Ask another admin.', 403);
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
        await tx.ledgerEntry.create({ data: { userId: r.userId, type: 'CAMPAIGN_REWARD', amount: r.campaign.reward, note: `Campaign: ${r.campaign.title}` } });
        await tx.user.update({ where: { id: r.userId }, data: { walletBalance: { increment: r.campaign.reward } } });
      }
    }
  });
  res.json({ success: true, message: 'Approved and the reward was added to the wallet.' });
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
