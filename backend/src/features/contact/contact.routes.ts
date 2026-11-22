import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { contactLimiter } from '../../shared/middleware/rateLimit.middleware';
import { validateBody } from '../../shared/middleware/validate.middleware';
import { requireAuth, requireRole } from '../auth';

/** The landing page contact form. Open to everyone (no login), so it is rate limited and has a hidden spam trap. */
export const contactRoutes = Router();
/** Admins read and tidy the messages. Mounted under /admin. */
export const contactAdminRoutes = Router();

const messageSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(120),
  whatsapp: z.string().trim().max(20).regex(/^([+\d][\d\s-]{5,18})?$/, 'Enter a valid WhatsApp number').default(''),
  message: z.string().trim().min(5, 'Write a short message').max(1500),
  /** Spam trap: the form hides this field, so only bots fill it in. */
  website: z.string().max(200).optional()
});

contactRoutes.post('/', contactLimiter, validateBody(messageSchema), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof messageSchema>;
  // a bot gets the same "thank you" and nothing is stored
  if (!b.website) {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [sameText, fromEmail, unread] = await Promise.all([
      prisma.contactMessage.count({ where: { email: b.email, message: b.message, createdAt: { gte: dayAgo } } }),
      prisma.contactMessage.count({ where: { email: b.email, createdAt: { gte: dayAgo } } }),
      prisma.contactMessage.count({ where: { handled: false } })
    ]);
    // the same text twice, or more than 5 a day from one email, is not stored again (a person who double-clicked is not told off)
    if (sameText === 0 && fromEmail < 5) {
      // a full inbox says so, instead of pretending to accept the message
      if (unread >= 2000) throw new AppError('Our inbox is full right now. Please reach us on WhatsApp.', 503);
      await prisma.contactMessage.create({ data: { name: b.name, email: b.email, whatsapp: b.whatsapp, message: b.message } });
    }
  }
  res.status(201).json({ success: true, message: 'Thank you! We will contact you soon.' });
});

// ---------------------------------------------------------------- admin

contactAdminRoutes.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

contactAdminRoutes.get('/messages', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const filter = req.query.handled === 'true' ? { handled: true } : req.query.handled === 'false' ? { handled: false } : {};
  const page = Math.min(100_000, Math.max(1, Math.floor(Number(req.query.page)) || 1));
  const where = {
    ...filter,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { whatsapp: { contains: q } },
            { message: { contains: q, mode: 'insensitive' as const } }
          ]
        }
      : {})
  };
  const [items, total, unread] = await Promise.all([
    prisma.contactMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 25, take: 25 }),
    prisma.contactMessage.count({ where }),
    prisma.contactMessage.count({ where: { handled: false } })
  ]);
  res.json({ success: true, data: { page, pageSize: 25, total, unread, items } });
});

contactAdminRoutes.post('/messages/:id/handled', validateBody(z.object({ handled: z.boolean() })), async (req: Request, res: Response) => {
  const done = await prisma.contactMessage.updateMany({ where: { id: String(req.params.id) }, data: { handled: req.body.handled } });
  if (done.count !== 1) throw new AppError('Message not found', 404);
  res.json({ success: true, message: req.body.handled ? 'Marked as done' : 'Marked as new' });
});

contactAdminRoutes.delete('/messages/:id', async (req: Request, res: Response) => {
  await prisma.contactMessage.deleteMany({ where: { id: String(req.params.id) } });
  res.json({ success: true, message: 'Deleted' });
});
