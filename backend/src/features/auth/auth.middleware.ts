import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { verifyAccessToken } from './auth.tokens';

export const ACCESS_COOKIE = 'accessToken';

const extractToken = (req: Request): string | undefined => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[ACCESS_COOKIE];
};

export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = extractToken(req);
    if (!token) return next(new AppError('Unauthorized', 401));

    let userId: string;
    try {
      ({ userId } = verifyAccessToken(token));
    } catch {
      return next(new AppError('Invalid or expired access token', 401));
    }

    // The database is the source of truth for role/package, never the JWT.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        package: true,
        referralCode: true,
        isActive: true,
        isVerified: true
      }
    });
    if (!user || !user.isActive || !user.isVerified) return next(new AppError('Unauthorized', 401));

    const { isActive: _a, isVerified: _v, ...rest } = user;
    req.user = rest;
    next();
  } catch (err) {
    next(err);
  }
};

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Unauthorized', 401));
    if (!roles.includes(req.user.role)) return next(new AppError('Forbidden', 403));
    next();
  };
