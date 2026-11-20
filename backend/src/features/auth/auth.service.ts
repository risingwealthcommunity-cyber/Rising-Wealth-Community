import bcrypt from 'bcrypt';
import { Leg, Prisma, User } from '@prisma/client';
import { prisma } from '../../config/database';
import { config } from '../../config/env';
import { AppError } from '../../shared/errors/AppError';
import { sendAdminLoginOtpEmail, sendResetPasswordEmail, sendVerificationEmail } from '../../shared/mail/mailer';
import { googleAuth } from './auth.google';
import { findPlacement, isPlacementCollision } from './auth.placement';
import {
  ADMIN_OTP_TTL_MS,
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  createOneTimeToken,
  generateOtp,
  generateReferralCode,
  hashToken,
  signAccessToken,
  signAdminTempToken,
  signRefreshToken,
  verifyAdminTempToken,
  verifyRefreshToken
} from './auth.tokens';
import type {
  LoginInput,
  ResetPasswordInput,
  SignupInput,
  VerifyAdminOtpInput
} from './auth.validator';

const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const MAX_RETRIES = 5;

/** Fields that are safe to send to the browser. */
export const toSafeUser = (user: User) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  photoUrl: user.photoUrl,
  role: user.role,
  package: user.package,
  rank: user.rank,
  referralCode: user.referralCode,
  sponsorId: user.sponsorId,
  parentId: user.parentId,
  leg: user.leg,
  hasPassword: Boolean(user.passwordHash),
  createdAt: user.createdAt
});

const isAdminRole = (user: User) => user.role !== 'USER';

/** Issues a fresh token pair and stores the refresh token hash (single active session, like NGO). */
async function startSession(user: User) {
  const accessToken = signAccessToken(user.id, user.role);
  const refreshToken = signRefreshToken(user.id);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), refreshTokenHash: hashToken(refreshToken) }
  });

  return { accessToken, refreshToken, user: toSafeUser(user) };
}

async function issueAdminOtp(user: User) {
  const otp = generateOtp();
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorOtpHash: hashToken(otp), twoFactorOtpExpiry: new Date(Date.now() + ADMIN_OTP_TTL_MS) }
  });

  try {
    await sendAdminLoginOtpEmail(user.email, otp);
  } catch (err) {
    console.error('[2FA] Failed to send admin OTP email:', err);
    throw new AppError('Failed to send verification code to admin email. Please try again.', 500);
  }
}

/** Puts a verified user into the sponsor's binary tree (retrying if two users race for a slot). */
async function placeInTree(userId: string, sponsorId: string, leg: Leg, extra: Prisma.UserUpdateInput) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const placement = await findPlacement(tx, sponsorId, leg);
        return tx.user.update({
          where: { id: userId },
          data: { ...extra, parent: { connect: { id: placement.parentId } }, leg: placement.leg }
        });
      });
    } catch (err) {
      if (!isPlacementCollision(err)) throw err;
    }
  }
  throw new AppError('Could not complete registration, please try again', 503);
}

const verifyLink = (token: string) => `${config.frontendUrl}/verify-email/${token}`;

export const authService = {
  /**
   * Creates an UNVERIFIED account under a sponsor. No session is issued;
   * the user must verify their email first (placement in the binary tree happens then).
   */
  async signup(input: SignupInput): Promise<void> {
    const sponsor = await prisma.user.findUnique({
      where: { referralCode: input.sponsorCode },
      select: { id: true, isActive: true }
    });
    if (!sponsor || !sponsor.isActive) throw new AppError('Invalid sponsor code', 400);

    // Do not reveal whether the account already exists.
    const email = normalizeEmail(input.email);
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return;

    if (input.phone && (await prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } }))) {
      throw new AppError('Mobile number already registered', 409);
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const verification = createOneTimeToken(EMAIL_VERIFICATION_TTL_MS);

    let user: User | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES && !user; attempt++) {
      try {
        user = await prisma.user.create({
          data: {
            name: input.name.trim(),
            email,
            phone: input.phone,
            passwordHash,
            referralCode: generateReferralCode(),
            sponsorId: sponsor.id,
            preferredLeg: input.leg,
            emailVerifyTokenHash: verification.tokenHash,
            emailVerifyExpiry: verification.expiresAt
          }
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
        const target = String((err.meta as { target?: unknown } | undefined)?.target ?? '');
        if (target.includes('email')) return; // lost a race with the same email
        if (target.includes('phone')) throw new AppError('Mobile number already registered', 409);
        // referral code collision: loop and try a new one
      }
    }
    if (!user) throw new AppError('Could not complete registration, please try again', 503);

    // If sending fails the account stays and the user can use "resend verification".
    await sendVerificationEmail(user.email, verifyLink(verification.rawToken));
  },

  async verifyEmail(token: string): Promise<void> {
    const raw = token.trim();
    if (!raw) throw new AppError('Invalid or expired verification link', 400);

    const user = await prisma.user.findFirst({
      where: { emailVerifyTokenHash: hashToken(raw), emailVerifyExpiry: { gt: new Date() } }
    });
    if (!user) throw new AppError('Invalid or expired verification link', 400);

    const verified = { isVerified: true, emailVerifyTokenHash: null, emailVerifyExpiry: null };

    if (user.sponsorId && !user.parentId) {
      await placeInTree(user.id, user.sponsorId, user.preferredLeg ?? 'LEFT', verified);
    } else {
      await prisma.user.update({ where: { id: user.id }, data: verified });
    }
  },

  async resendVerificationEmail(email: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    if (!user || user.isVerified) return; // prevent account enumeration

    const verification = createOneTimeToken(EMAIL_VERIFICATION_TTL_MS);
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifyTokenHash: verification.tokenHash, emailVerifyExpiry: verification.expiresAt }
    });
    await sendVerificationEmail(user.email, verifyLink(verification.rawToken));
  },

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(input.email) } });

    if (!user || !user.isActive || !user.passwordHash) throw new AppError('Invalid email or password', 401);
    if (!(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new AppError('Invalid email or password', 401);
    }
    if (!user.isVerified) throw new AppError('Please verify your email before logging in.', 403);

    if (isAdminRole(user) && process.env.ENABLE_ADMIN_2FA === 'true') {
      await issueAdminOtp(user);
      const [local, domain] = user.email.split('@');
      return {
        requireOtp: true as const,
        tempToken: signAdminTempToken(user.id, user.email),
        email: domain ? `${local.slice(0, 3)}***@${domain}` : user.email,
        message: 'A 6-digit verification code has been sent to your email.'
      };
    }

    return { requireOtp: false as const, ...(await startSession(user)) };
  },

  async verifyAdminOtp(input: VerifyAdminOtpInput) {
    let userId: string;
    try {
      ({ userId } = verifyAdminTempToken(input.tempToken));
    } catch {
      throw new AppError('2FA verification session has expired. Please sign in again.', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new AppError('Account not found or inactive.', 401);
    if (!user.twoFactorOtpHash || !user.twoFactorOtpExpiry) {
      throw new AppError('No pending 2FA code found. Please sign in again.', 400);
    }
    if (user.twoFactorOtpExpiry < new Date()) {
      throw new AppError('Verification code has expired. Please request a new code.', 400);
    }

    // Development convenience only (never in production or tests).
    const devMasterOtp = config.nodeEnv === 'development' && input.otp === '123456';
    if (!devMasterOtp && user.twoFactorOtpHash !== hashToken(input.otp)) {
      throw new AppError('Incorrect verification code. Please check and try again.', 400);
    }

    await prisma.user.update({ where: { id: user.id }, data: { twoFactorOtpHash: null, twoFactorOtpExpiry: null } });
    return startSession(user);
  },

  async resendAdminOtp(tempToken: string) {
    let userId: string;
    try {
      ({ userId } = verifyAdminTempToken(tempToken));
    } catch {
      throw new AppError('2FA session has expired. Please sign in again.', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new AppError('Account not found or inactive.', 401);

    if (user.twoFactorOtpExpiry) {
      const remainingMs = user.twoFactorOtpExpiry.getTime() - Date.now();
      if (remainingMs > ADMIN_OTP_TTL_MS - 45 * 1000) {
        throw new AppError('Please wait at least 45 seconds before requesting a new code.', 429);
      }
    }

    await issueAdminOtp(user);
    return { message: 'A fresh 6-digit verification code has been sent to your email.' };
  },

  /**
   * Google sign-in. Existing accounts just log in. A brand-new Google user needs a valid
   * sponsor (taken from the referral link), otherwise SPONSOR_REQUIRED is thrown.
   */
  async handleGoogleLogin(code: string, signupRef?: { sponsorCode: string; leg: Leg }) {
    const profile = await googleAuth.profileFromCode(code);
    const email = normalizeEmail(profile.email);

    let user = await prisma.user.findUnique({ where: { googleId: profile.googleId } });

    if (!user) {
      const byEmail = await prisma.user.findUnique({ where: { email } });

      if (byEmail) {
        // Link Google to the existing account. Google already proved ownership of the email.
        const link = { googleId: profile.googleId, photoUrl: byEmail.photoUrl || profile.photoUrl || '' };
        const verified = { ...link, isVerified: true, emailVerifyTokenHash: null, emailVerifyExpiry: null };

        if (!byEmail.isVerified && byEmail.sponsorId && !byEmail.parentId) {
          user = await placeInTree(byEmail.id, byEmail.sponsorId, byEmail.preferredLeg ?? 'LEFT', verified);
        } else {
          user = await prisma.user.update({ where: { id: byEmail.id }, data: byEmail.isVerified ? link : verified });
        }
      } else {
        const sponsor = signupRef
          ? await prisma.user.findUnique({
              where: { referralCode: signupRef.sponsorCode },
              select: { id: true, isActive: true }
            })
          : null;
        if (!sponsor || !sponsor.isActive) throw new AppError('SPONSOR_REQUIRED', 400);

        let created: User | null = null;
        for (let attempt = 0; attempt < MAX_RETRIES && !created; attempt++) {
          try {
            created = await prisma.user.create({
              data: {
                name: profile.name.trim(),
                email,
                googleId: profile.googleId,
                photoUrl: profile.photoUrl ?? '',
                referralCode: generateReferralCode(),
                sponsorId: sponsor.id,
                preferredLeg: signupRef!.leg,
                isVerified: false
              }
            });
          } catch (err) {
            if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
            const target = String((err.meta as { target?: unknown } | undefined)?.target ?? '');
            if (!target.includes('referralCode')) throw err;
          }
        }
        if (!created) throw new AppError('Could not complete registration, please try again', 503);
        user = await placeInTree(created.id, sponsor.id, signupRef!.leg, { isVerified: true });
      }
    }

    if (!user.isActive) throw new AppError('Invalid email or password', 401);
    return startSession(user);
  },

  async logout(refreshToken: string): Promise<void> {
    const token = refreshToken.trim();
    if (!token) return;
    await prisma.user.updateMany({ where: { refreshTokenHash: hashToken(token) }, data: { refreshTokenHash: null } });
  },

  async refreshAccessToken(token: string) {
    const invalid = () => new AppError('Invalid or expired refresh token', 401);
    const raw = token.trim();
    if (!raw) throw invalid();

    let userId: string;
    try {
      ({ userId } = verifyRefreshToken(raw));
    } catch {
      throw invalid();
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const currentHash = hashToken(raw);
    if (!user || !user.isActive || !user.refreshTokenHash || user.refreshTokenHash !== currentHash) throw invalid();
    if (!user.isVerified) throw new AppError('Please verify your email before logging in.', 403);

    const accessToken = signAccessToken(user.id, user.role);
    const refreshToken = signRefreshToken(user.id);

    // Atomic rotation: only succeeds if the stored hash is still the one the client presented.
    const rotated = await prisma.user.updateMany({
      where: { id: user.id, refreshTokenHash: currentHash },
      data: { refreshTokenHash: hashToken(refreshToken) }
    });
    if (rotated.count !== 1) throw invalid();

    return { accessToken, refreshToken };
  },

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);
    return toSafeUser(user);
  },

  async forgotPassword(email: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    if (!user || !user.isActive) return; // prevent account enumeration

    const reset = createOneTimeToken(PASSWORD_RESET_TTL_MS);
    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordTokenHash: reset.tokenHash, resetPasswordExpiry: reset.expiresAt }
    });

    // Sent in the background so the response is immediate.
    sendResetPasswordEmail(user.email, `${config.frontendUrl}/reset-password/${reset.rawToken}`).catch((e) =>
      console.error('[Auth] Failed to send password reset email:', e)
    );
  },

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const user = await prisma.user.findFirst({
      where: { resetPasswordTokenHash: hashToken(input.token.trim()), resetPasswordExpiry: { gt: new Date() } }
    });
    if (!user || !user.isActive) throw new AppError('Invalid or expired reset token', 400);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS),
        resetPasswordTokenHash: null,
        resetPasswordExpiry: null,
        refreshTokenHash: null // invalidate the existing session
      }
    });
  },

  /** For Google-only accounts that want to add a password. */
  async setPassword(userId: string, password: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new AppError('User not found or inactive', 404);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) }
    });
  }
};
