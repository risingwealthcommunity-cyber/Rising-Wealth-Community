import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { validateBody } from '../../shared/middleware/validate.middleware';
import { requireAuth, requireRole } from '../auth';

/** Members: live trainings. A session above your package is listed, but its join link is never sent. */
export const liveRoutes = Router();
/** Admins: manage the sessions. Mounted under /admin. */
export const liveAdminRoutes = Router();

const TIER = { TRAINEE: 0, PRO: 1, ELITE: 2 } as const;
/** A session stays in the list for this long after it starts, so people can still join a running one. */
const STAYS_MS = 3 * 3_600_000;

liveRoutes.get('/', requireAuth, async (req: Request, res: Response) => {
  const { package: pkg, role } = req.user!;
  const isAdmin = role !== 'USER';
  const rows = await prisma.liveSession.findMany({
    where: { isActive: true, startsAt: { gte: new Date(Date.now() - STAYS_MS) } },
    orderBy: { startsAt: 'asc' },
    take: 50
  });
  res.json({
    success: true,
    data: {
      items: rows.map((s) => {
        const unlocked = isAdmin || TIER[pkg] >= TIER[s.minTier];
        return {
          id: s.id,
          title: s.title,
          description: s.description,
          startsAt: s.startsAt,
          minTier: s.minTier,
          unlocked,
          ...(unlocked ? { link: s.link } : {})
        };
      })
    }
  });
});

// ---------------------------------------------------------------- admin

liveAdminRoutes.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

const sessionSchema = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(''),
  startsAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Choose the date and time'),
  link: z.string().trim().max(300).regex(/^https:\/\/\S+$/i, 'The link must start with https://'),
  minTier: z.enum(['TRAINEE', 'PRO', 'ELITE']).default('TRAINEE'),
  isActive: z.boolean().default(true)
});

liveAdminRoutes.get('/live', async (_req: Request, res: Response) => {
  const items = await prisma.liveSession.findMany({ orderBy: { startsAt: 'desc' }, take: 100 });
  res.json({ success: true, data: { items } });
});

liveAdminRoutes.post('/live', validateBody(sessionSchema), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof sessionSchema>;
  const s = await prisma.liveSession.create({ data: { ...b, startsAt: new Date(b.startsAt) } });
  res.status(201).json({ success: true, message: 'Live training added', data: s });
});

liveAdminRoutes.put('/live/:id', validateBody(sessionSchema), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof sessionSchema>;
  const done = await prisma.liveSession.updateMany({ where: { id: String(req.params.id) }, data: { ...b, startsAt: new Date(b.startsAt) } });
  if (done.count !== 1) throw new AppError('Session not found', 404);
  res.json({ success: true, message: 'Saved' });
});

liveAdminRoutes.delete('/live/:id', async (req: Request, res: Response) => {
  await prisma.liveSession.deleteMany({ where: { id: String(req.params.id) } });
  res.json({ success: true, message: 'Deleted' });
});
