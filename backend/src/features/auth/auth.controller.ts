import crypto from 'crypto';
import { Request, Response, CookieOptions } from 'express';
import { config } from '../../config/env';
import { AppError } from '../../shared/errors/AppError';
import { authService } from './auth.service';
import { googleAuth } from './auth.google';
import { ACCESS_TOKEN_MS, REFRESH_TOKEN_MS } from './auth.tokens';
import { ACCESS_COOKIE } from './auth.middleware';

const REFRESH_COOKIE = 'refreshToken';
const GOOGLE_STATE_COOKIE = 'googleOAuthState';
const GOOGLE_REF_COOKIE = 'googleSignupRef';
const GOOGLE_COOKIE_MS = 10 * 60 * 1000;

const baseCookie: CookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: config.isProduction ? 'none' : 'lax',
  path: '/'
};
const googleCookie: CookieOptions = { ...baseCookie, path: '/api/auth/google', maxAge: GOOGLE_COOKIE_MS };

const setAuthCookies = (res: Response, t: { accessToken: string; refreshToken: string }) => {
  res.cookie(ACCESS_COOKIE, t.accessToken, { ...baseCookie, maxAge: ACCESS_TOKEN_MS });
  res.cookie(REFRESH_COOKIE, t.refreshToken, { ...baseCookie, maxAge: REFRESH_TOKEN_MS });
};

const clearAuthCookies = (res: Response) => {
  res.clearCookie(ACCESS_COOKIE, baseCookie);
  res.clearCookie(REFRESH_COOKIE, baseCookie);
};

const single = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const wantsHtml = (req: Request) => Boolean(req.headers.accept?.includes('text/html'));

export const signup = async (req: Request, res: Response) => {
  await authService.signup(req.body);
  res.status(201).json({
    success: true,
    message: 'Account created successfully. Please verify your email before logging in.'
  });
};

export const verifyEmail = async (req: Request, res: Response) => {
  const token = single(req.params.token);
  if (!token) throw new AppError('Verification token missing', 400);

  try {
    await authService.verifyEmail(token);
  } catch (err) {
    // Opened straight from the email client in a browser: bounce to the login page.
    if (wantsHtml(req)) return res.redirect(`${config.frontendUrl}/login?error=verification_failed`);
    throw err;
  }

  if (wantsHtml(req)) return res.redirect(`${config.frontendUrl}/login?verified=true`);
  res.json({ success: true, message: 'Email verified successfully' });
};

export const resendVerificationEmail = async (req: Request, res: Response) => {
  await authService.resendVerificationEmail(req.body.email);
  res.json({
    success: true,
    message: 'If the account requires verification, a verification email has been sent.'
  });
};

export const login = async (req: Request, res: Response) => {
  const result = await authService.login(req.body);

  if (result.requireOtp) {
    res.json({
      success: true,
      requireOtp: true,
      data: { tempToken: result.tempToken, email: result.email, message: result.message }
    });
    return;
  }

  setAuthCookies(res, result);
  res.json({ success: true, data: { user: result.user } });
};

export const verifyAdminOtp = async (req: Request, res: Response) => {
  const { accessToken, refreshToken, user } = await authService.verifyAdminOtp(req.body);
  setAuthCookies(res, { accessToken, refreshToken });
  res.json({ success: true, message: 'Admin verification successful', data: { user } });
};

export const resendAdminOtp = async (req: Request, res: Response) => {
  const result = await authService.resendAdminOtp(req.body.tempToken);
  res.json({ success: true, message: result.message });
};

/** GET /auth/google?ref=SPONSORCODE&leg=LEFT  (ref/leg only matter for brand-new accounts) */
export const googleLogin = async (req: Request, res: Response) => {
  const state = crypto.randomBytes(32).toString('hex');
  const url = googleAuth.getAuthorizationUrl(state); // throws 503 if Google is not configured

  res.cookie(GOOGLE_STATE_COOKIE, state, googleCookie);

  const ref = single(req.query.ref);
  if (ref) {
    const leg = req.query.leg === 'RIGHT' ? 'RIGHT' : 'LEFT';
    res.cookie(GOOGLE_REF_COOKIE, JSON.stringify({ sponsorCode: ref.toUpperCase().slice(0, 20), leg }), googleCookie);
  } else {
    res.clearCookie(GOOGLE_REF_COOKIE, googleCookie);
  }

  res.redirect(url);
};

export const googleCallback = async (req: Request, res: Response) => {
  const fail = (reason: string) => {
    res.clearCookie(GOOGLE_STATE_COOKIE, googleCookie);
    res.clearCookie(GOOGLE_REF_COOKIE, googleCookie);
    res.redirect(`${config.frontendUrl}/login?error=${reason}`);
  };

  try {
    const code = single(req.query.code);
    const received = single(req.query.state);
    const stored = single(req.cookies?.[GOOGLE_STATE_COOKIE]);

    if (!code || !received || !stored || !safeEqual(stored, received)) return fail('GoogleAuthFailed');

    let signupRef: { sponsorCode: string; leg: 'LEFT' | 'RIGHT' } | undefined;
    try {
      const raw = single(req.cookies?.[GOOGLE_REF_COOKIE]);
      if (raw) signupRef = JSON.parse(raw);
    } catch {
      signupRef = undefined;
    }

    res.clearCookie(GOOGLE_STATE_COOKIE, googleCookie);
    res.clearCookie(GOOGLE_REF_COOKIE, googleCookie);

    const session = await authService.handleGoogleLogin(code, signupRef);
    setAuthCookies(res, session);
    res.redirect(`${config.frontendUrl}/dashboard`);
  } catch (err) {
    console.error('[GoogleOAuth] failure:', err instanceof Error ? err.message : err);
    fail(err instanceof AppError && err.message === 'SPONSOR_REQUIRED' ? 'sponsor_required' : 'GoogleAuthFailed');
  }
};

export const logout = async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) await authService.logout(token);
  clearAuthCookies(res);
  res.json({ success: true, message: 'Logged out successfully' });
};

export const refresh = async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw new AppError('Refresh token missing', 401);

  try {
    setAuthCookies(res, await authService.refreshAccessToken(token));
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
  res.json({ success: true, message: 'Token refreshed' });
};

export const me = async (req: Request, res: Response) => {
  res.json({ success: true, data: { user: await authService.getMe(req.user!.id) } });
};

export const forgotPassword = async (req: Request, res: Response) => {
  await authService.forgotPassword(req.body.email);
  res.json({ success: true, message: 'If the email exists, a password reset link has been sent.' });
};

export const resetPassword = async (req: Request, res: Response) => {
  await authService.resetPassword(req.body);
  res.json({ success: true, message: 'Password reset successful' });
};

export const setPassword = async (req: Request, res: Response) => {
  await authService.setPassword(req.user!.id, req.body.password);
  res.json({ success: true, message: 'Password set successfully' });
};
