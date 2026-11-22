import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from './auth';
import { validateBody } from '../shared/middleware/validate.middleware';
import { uploadLimiter } from '../shared/middleware/rateLimit.middleware';
import { MAX_UPLOAD_BYTES, isR2On, signUpload } from '../shared/storage';

const router = Router();

/**
 * Direct upload: the browser asks for a one-time address, sends the picture straight to storage, then names it in the request that
 * uses it. When storage is not set up, direct is false and the browser sends the picture inside the request as before.
 */
router.post(
  '/sign',
  requireAuth,
  uploadLimiter,
  validateBody(z.object({ mime: z.enum(['image/jpeg', 'image/png', 'image/webp']), size: z.number().int().min(100).max(MAX_UPLOAD_BYTES) })),
  async (req: Request, res: Response) => {
    if (!isR2On()) {
      res.json({ success: true, data: { direct: false } });
      return;
    }
    const { mime, size } = req.body as { mime: string; size: number };
    const up = await signUpload(req.user!.id, mime, size);
    res.json({ success: true, data: { direct: true, url: up.url, key: up.key, expiresIn: up.expiresIn } });
  }
);

export default router;
