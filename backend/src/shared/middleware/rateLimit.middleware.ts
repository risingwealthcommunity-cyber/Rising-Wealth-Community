import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';

const make = (windowMs: number, max: number, message: string) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, _res: Response, next: NextFunction) => next(new AppError(message, 429))
  });

/** Global limiter for all /api routes. */
export const apiLimiter = make(15 * 60 * 1000, 3000, 'Too many requests, please try again after 15 minutes.');

/** Login-style endpoints: 60 attempts / 5 min. */
export const authLimiter = make(5 * 60 * 1000, 60, 'Too many authentication attempts, please try again after 5 minutes.');

/** Sensitive operations (signup, verification, password reset): 20 / 10 min. */
export const strictAuthLimiter = make(
  10 * 60 * 1000,
  20,
  'Too many sensitive operations requested, please try again after 10 minutes.'
);
