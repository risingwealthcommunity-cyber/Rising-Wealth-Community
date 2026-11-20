import { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';
import { AppError } from '../errors/AppError';

export const validateBody =
  (schema: ZodType) => (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new AppError(result.error.issues[0]?.message ?? 'Invalid request data', 400));
      return;
    }
    req.body = result.data;
    next();
  };
