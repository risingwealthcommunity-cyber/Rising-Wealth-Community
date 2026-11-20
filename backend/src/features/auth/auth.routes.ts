import { Router, Request, Response, NextFunction } from 'express';
import { validateBody } from '../../shared/middleware/validate.middleware';
import { authLimiter, strictAuthLimiter } from '../../shared/middleware/rateLimit.middleware';
import { requireAuth } from './auth.middleware';
import {
  emailOnlySchema,
  loginSchema,
  resendAdminOtpSchema,
  resetPasswordSchema,
  setPasswordSchema,
  signupSchema,
  verifyAdminOtpSchema
} from './auth.validator';
import * as c from './auth.controller';

const router = Router();

// Auth responses must never be cached.
router.use((_req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.post('/signup', strictAuthLimiter, validateBody(signupSchema), c.signup);
router.get('/verify-email/:token', strictAuthLimiter, c.verifyEmail);
router.post('/resend-verification', strictAuthLimiter, validateBody(emailOnlySchema), c.resendVerificationEmail);

router.post('/login', authLimiter, validateBody(loginSchema), c.login);
router.post('/verify-admin-otp', strictAuthLimiter, validateBody(verifyAdminOtpSchema), c.verifyAdminOtp);
router.post('/resend-admin-otp', strictAuthLimiter, validateBody(resendAdminOtpSchema), c.resendAdminOtp);

router.get('/google', authLimiter, c.googleLogin);
router.get('/google/callback', authLimiter, c.googleCallback);

router.post('/logout', c.logout);
router.post('/refresh', authLimiter, c.refresh);
router.get('/me', requireAuth, c.me);

router.post('/forgot-password', strictAuthLimiter, validateBody(emailOnlySchema), c.forgotPassword);
router.post('/reset-password', strictAuthLimiter, validateBody(resetPasswordSchema), c.resetPassword);
router.post('/password/set', requireAuth, strictAuthLimiter, validateBody(setPasswordSchema), c.setPassword);

export default router;
