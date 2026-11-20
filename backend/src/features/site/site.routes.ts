import express, { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../auth';
import { ASSET_MIME_TYPES, MAX_ASSET_BYTES, parseKey, siteService } from './site.service';

const router = Router();

// Public: the landing page asks which images exist, then loads them.
router.get('/assets', async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ success: true, data: { assets: await siteService.list() } });
});

router.get('/assets/:key', async (req: Request, res: Response) => {
  const row = await siteService.get(parseKey(req.params.key));
  const etag = `W/"${row.updatedAt.getTime()}"`;

  // The listing URL carries ?v=<updatedAt>, so a given URL never changes and can be cached for good.
  res.setHeader('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
  res.setHeader('ETag', etag);
  // Helmet defaults to same-origin; the site may be served from a different origin than the API.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.type(row.mime).send(Buffer.from(row.data));
});

// Admin only. The file is sent as the raw request body with its own Content-Type (no multipart).
router.put(
  '/assets/:key',
  requireAuth,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  express.raw({ type: ASSET_MIME_TYPES, limit: MAX_ASSET_BYTES }),
  async (req: Request, res: Response) => {
    const asset = await siteService.save(parseKey(req.params.key), req.body);
    res.json({ success: true, message: 'Image saved', data: { asset } });
  }
);

router.delete('/assets/:key', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req: Request, res: Response) => {
  await siteService.remove(parseKey(req.params.key));
  res.json({ success: true, message: 'Image removed' });
});

export default router;
