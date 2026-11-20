import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env';

export const ACCESS_TOKEN_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
export const ADMIN_OTP_TTL_MS = 10 * 60 * 1000;
/** Emailed 6-digit codes (verification and password reset). */
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
/** At most one verification / reset email per account per minute (stops email bombing). */
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

export const signAccessToken = (userId: string, role: string): string =>
  jwt.sign({ userId, role, typ: 'access' }, config.jwt.access, { expiresIn: Math.floor(ACCESS_TOKEN_MS / 1000) });

export const signRefreshToken = (userId: string): string =>
  // jti keeps two tokens issued in the same second different.
  jwt.sign({ userId, jti: crypto.randomUUID() }, config.jwt.refresh, {
    expiresIn: Math.floor(REFRESH_TOKEN_MS / 1000)
  });

export const signAdminTempToken = (userId: string, email: string): string =>
  jwt.sign({ userId, email, purpose: 'admin_2fa', typ: 'admin_2fa' }, config.jwt.access, { expiresIn: 10 * 60 });

const userIdOf = (payload: string | jwt.JwtPayload): string => {
  if (typeof payload === 'string' || typeof payload.userId !== 'string' || !payload.userId.trim()) {
    throw new Error('Invalid token payload');
  }
  return payload.userId;
};

/**
 * Only real access tokens pass. The admin 2FA temp token is signed with the same secret, so without the
 * type check it would work as a login session and skip the one-time code entirely.
 */
export const verifyAccessToken = (token: string): { userId: string } => {
  const payload = jwt.verify(token, config.jwt.access);
  if (typeof payload === 'string' || payload.typ !== 'access') throw new Error('Wrong token type');
  return { userId: userIdOf(payload) };
};

export const verifyRefreshToken = (token: string): { userId: string } => ({
  userId: userIdOf(jwt.verify(token, config.jwt.refresh))
});

export const verifyAdminTempToken = (token: string): { userId: string } => {
  const payload = jwt.verify(token, config.jwt.access);
  if (typeof payload === 'string' || payload.purpose !== 'admin_2fa' || payload.typ !== 'admin_2fa') {
    throw new Error('Wrong token purpose');
  }
  return { userId: userIdOf(payload) };
};

export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export const generateReferralCode = (): string => 'RWC' + crypto.randomBytes(4).toString('hex').toUpperCase();

/** Raw token goes in the email link, only its hash is stored. */
export const createOneTimeToken = (ttlMs: number) => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  return { rawToken, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + ttlMs) };
};

export const generateOtp = (): string => crypto.randomInt(100000, 1000000).toString();

type CodePurpose = 'verify' | 'reset';

/**
 * Codes are stored as an HMAC bound to the account and the purpose. A leaked database cannot be brute
 * forced offline (the secret is needed), and a code never works for another account or another purpose.
 */
export const hashCode = (purpose: CodePurpose, userId: string, code: string): string =>
  crypto.createHmac('sha256', config.jwt.refresh).update(`${purpose}:${userId}:${code}`).digest('hex');

export const codeMatches = (storedHash: string, purpose: CodePurpose, userId: string, code: string): boolean => {
  const a = Buffer.from(storedHash);
  const b = Buffer.from(hashCode(purpose, userId, code));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
