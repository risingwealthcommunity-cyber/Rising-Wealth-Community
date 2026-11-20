import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Stops cross-site request forgery. In production the login cookies are SameSite=None (the site and the API
 * can live on different domains), so another website could make a logged-in admin's browser send a plain form
 * POST such as "confirm this purchase". Browsers always label such a request with its Origin, so any
 * state-changing request from an origin we do not know is refused. Requests without an Origin header
 * (curl, server to server, tests) are not browser cross-site requests and pass.
 */
export const originGuard =
  (allowedOrigins: string[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.includes(origin)) return next();
    next(new AppError('Request blocked: untrusted origin', 403));
  };
