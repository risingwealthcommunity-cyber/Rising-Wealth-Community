import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from './AppError';
import { config } from '../../config/env';

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, message: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: err.issues[0]?.message ?? 'Invalid request data'
    });
    return;
  }

  // body-parser (e.g. an upload bigger than its limit) raises plain errors with a type.
  if ((err as { type?: string })?.type === 'entity.too.large') {
    res.status(413).json({ success: false, message: 'File is too large' });
    return;
  }

  console.error('[ErrorHandler]', err);
  res.status(500).json({
    success: false,
    message: config.isProduction ? 'Internal Server Error' : String((err as Error)?.message ?? err)
  });
};
