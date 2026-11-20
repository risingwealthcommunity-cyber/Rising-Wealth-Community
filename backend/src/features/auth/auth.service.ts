import bcrypt from 'bcrypt';
import { timingSafeEqual } from 'crypto';
import { Leg, Prisma, User } from '@prisma/client';
import { prisma } from '../../config/database';
import { config } from '../../config/env';
import { AppError } from '../../shared/errors/AppError';
import {
  sendAdminLoginOtpEmail,
  sendPasswordChangedEmail,
  sendResetPasswordEmail,
  sendVerificationEmail
} from '../../shared/mail/mailer';
import { googleAuth } from './auth.google';
import { findPlacement, isPlacementCollision } from './auth.placement';
import {
  ADMIN_OTP_TTL_MS,
  EMAIL_CODE_TTL_MS,
  EMAIL_VERIFICATION_TTL_MS,
  MAX_CODE_ATTEMPTS,
  PASSWORD_RESET_TTL_MS,
  RESEND_COOLDOWN_MS,
  codeMatches,
  createOneTimeToken,
  generateOtp,
  generateReferralCode,
  hashCode,
  hashToken,
  signAccessToken,
  signAdminTempToken,
  signRefreshToken,
  verifyAdminTempToken,
  verifyRefreshToken
} from './auth.tokens';
import type {
  LoginInput,
  ResetPasswordCodeInput,
  ResetPasswordInput,
  SignupInput,
  VerifyAdminOtpInput
} from './auth.validator';

const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const MAX_RETRIES = 5;
/** A 6 digit code may be guessed this many times; after that it is thrown away and the admin must log in again. */
const MAX_OTP_ATTEMPTS = 5;
/** Compared against when the email is unknown, so "no such account" takes as long as "wrong password". */
const DUMMY_HASH = bcrypt.hashSync('rwc-timing-equalizer', BCRYPT_ROUNDS);

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
    data: {
      twoFactorOtpHash: hashToken(otp),
      twoFactorOtpExpiry: new Date(Date.now() + ADMIN_OTP_TTL_MS),
      twoFactorAttempts: 0
    }
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

/** True if a link/code was issued less than a minute ago (issue time = expiry - lifetime). */
const sentJustNow = (expiry: Date | null, lifetimeMs: number) =>
  Boolean(expiry && expiry.getTime() - lifetimeMs > Date.now() - RESEND_COOLDOWN_MS);

/** A fresh verification link AND 6-digit code; both replace whatever was issued before. */
async function issueVerification(user: User) {
  const link = createOneTimeToken(EMAIL_VERIFICATION_TTL_MS);
  const code = generateOtp();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifyTokenHash: link.tokenHash,
      emailVerifyExpiry: link.expiresAt,
      emailVerifyCodeHash: hashCode('verify', user.id, code),
      emailVerifyCodeExpiry: new Date(Date.now() + EMAIL_CODE_TTL_MS),
      emailVerifyCodeAttempts: 0
    }
  });
  await sendVerificationEmail(user.email, verifyLink(link.rawToken), code);
}

/** Marks the account verified and, for members under a sponsor, places them in the binary tree. */
async function completeVerification(user: User) {
  const verified = {
    isVerified: true,
    emailVerifyTokenHash: null,
    emailVerifyExpiry: null,
    emailVerifyCodeHash: null,
    emailVerifyCodeExpiry: null,
    emailVerifyCodeAttempts: 0
  };
  if (user.sponsorId && !user.parentId) {
    await placeInTree(user.id, user.sponsorId, user.preferredLeg ?? 'LEFT', verified);
  } else {
    await prisma.user.update({ where: { id: user.id }, data: verified });
  }
}

const INVALID_CODE = 'Invalid or expired code. If this keeps happening, request a new one.';

/** After a wrong code: count it, and burn the code once it has been guessed wrong too many times. */
async function recordWrongCode(userId: string, kind: 'verify' | 'reset') {
  if (kind === 'verify') {
    const { emailVerifyCodeAttempts } = await prisma.user.update({
      where: { id: userId },
      data: { emailVerifyCodeAttempts: { increment: 1 } },
      select: { emailVerifyCodeAttempts: true }
    });
    if (emailVerifyCodeAttempts >= MAX_CODE_ATTEMPTS) {
      await prisma.user.update({ where: { id: userId }, data: { emailVerifyCodeHash: null, emailVerifyCodeExpiry: null } });
    }
  } else {
    const { resetCodeAttempts } = await prisma.user.update({
      where: { id: userId },
      data: { resetCodeAttempts: { increment: 1 } },
      select: { resetCodeAttempts: true }
    });
    if (resetCodeAttempts >= MAX_CODE_ATTEMPTS) {
      await prisma.user.update({ where: { id: userId }, data: { resetCodeHash: null, resetCodeExpiry: null } });
    }
  }
}

/** Security alert: tell the owner their password changed (sent in the background). */
const notifyPasswordChanged = (email: string) =>
  sendPasswordChangedEmail(email).catch((e) => console.error('[Auth] Failed to send password-changed email:', e));

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
            preferredLeg: input.leg
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
    await issueVerification(user);
  },

  async verifyEmail(token: string): Promise<void> {
    const raw = token.trim();
    if (!raw) throw new AppError('Invalid or expired verification link', 400);

    const user = await prisma.user.findFirst({
      where: { emailVerifyTokenHash: hashToken(raw), emailVerifyExpiry: { gt: new Date() } }
    });
    if (!user) throw new AppError('Invalid or expired verification link', 400);

    await completeVerification(user);
  },

  async resendVerificationEmail(email: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    if (!user || user.isVerified) return; // prevent account enumeration
    if (sentJustNow(user.emailVerifyExpiry, EMAIL_VERIFICATION_TTL_MS)) return; // one email per minute
    await issueVerification(user);
  },

  /** The 6-digit alternative to the emailed link. Every failure looks the same from outside. */
  async verifyEmailCode(emailRaw: string, code: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(emailRaw) } });
    const usable =
      user &&
      !user.isVerified &&
      user.emailVerifyCodeHash &&
      user.emailVerifyCodeExpiry &&
      user.emailVerifyCodeExpiry > new Date() &&
      user.emailVerifyCodeAttempts < MAX_CODE_ATTEMPTS;

    if (!user || !usable || !user.emailVerifyCodeHash) {
      hashCode('verify', 'no-such-user', code); // same work whether or not the account exists
      throw new AppError(INVALID_CODE, 400);
    }
    if (!codeMatches(user.emailVerifyCodeHash, 'verify', user.id, code)) {
      await recordWrongCode(user.id, 'verify');
      throw new AppError(INVALID_CODE, 400);
    }
    await completeVerification(user);
  },

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(input.email) } });

    if (!user || !user.isActive || !user.passwordHash) {
      await bcrypt.compare(input.password, DUMMY_HASH); // same cost whether or not the account exists
      throw new AppError('Invalid email or password', 401);
    }
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

    // Local convenience only: needs NODE_ENV=development AND ALLOW_DEV_MASTER_OTP=true (never in production or tests).
    const devMasterOtp = config.nodeEnv === 'development' && config.allowDevMasterOtp && input.otp === '123456';
    const given = Buffer.from(hashToken(input.otp));
    const stored = Buffer.from(user.twoFactorOtpHash);
    const matches = given.length === stored.length && timingSafeEqual(given, stored);
    if (!devMasterOtp && !matches) {
      const { twoFactorAttempts } = await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorAttempts: { increment: 1 } },
        select: { twoFactorAttempts: true }
      });
      if (twoFactorAttempts >= MAX_OTP_ATTEMPTS) {
        await prisma.user.update({ where: { id: user.id }, data: { twoFactorOtpHash: null, twoFactorOtpExpiry: null } });
        throw new AppError('Too many wrong codes. Please sign in again to get a new one.', 429);
      }
      throw new AppError('Incorrect verification code. Please check and try again.', 400);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorOtpHash: null, twoFactorOtpExpiry: null, twoFactorAttempts: 0 }
    });
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
        // Nobody has verified this account yet, so it may have been created by someone else using this
        // email. Whoever proves ownership through Google takes it over completely: the signup password,
        // any session and any pending reset link are discarded.
        const verified = {
          ...link,
          isVerified: true,
          emailVerifyTokenHash: null,
          emailVerifyExpiry: null,
          emailVerifyCodeHash: null,
          emailVerifyCodeExpiry: null,
          resetCodeHash: null,
          resetCodeExpiry: null,
          passwordHash: null,
          refreshTokenHash: null,
          resetPasswordTokenHash: null,
          resetPasswordExpiry: null
        };

        if (!byEmail.isVerified && byEmail.sponsorId && !byEmail.parentId) {
          user = await placeInTree(byEmail.id, byEmail.sponsorId, byEmail.preferredLeg ?? 'LEFT', verified);
        } else {
          user = await prisma.user.update({ where: { id: byEmail.id }, data: byEmail.isVerified ? link : verified });
        }
      } else {
        // Logging in never creates an account. That only happens from a referral / register link.
        if (!signupRef) throw new AppError('ACCOUNT_NOT_FOUND', 404);
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
    if (sentJustNow(user.resetPasswordExpiry, PASSWORD_RESET_TTL_MS)) return; // one email per minute

    const reset = createOneTimeToken(PASSWORD_RESET_TTL_MS);
    const code = generateOtp();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordTokenHash: reset.tokenHash,
        resetPasswordExpiry: reset.expiresAt,
        resetCodeHash: hashCode('reset', user.id, code),
        resetCodeExpiry: new Date(Date.now() + EMAIL_CODE_TTL_MS),
        resetCodeAttempts: 0
      }
    });

    // Sent in the background so the response is immediate (and equally fast for unknown emails).
    sendResetPasswordEmail(user.email, `${config.frontendUrl}/reset-password/${reset.rawToken}`, code).catch((e) =>
      console.error('[Auth] Failed to send password reset email:', e)
    );
  },

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const user = await prisma.user.findFirst({
      where: { resetPasswordTokenHash: hashToken(input.token.trim()), resetPasswordExpiry: { gt: new Date() } }
    });
    if (!user || !user.isActive) throw new AppError('Invalid or expired reset token', 400);
    await this.applyNewPassword(user, input.newPassword);
  },

  /** The 6-digit alternative to the reset link. Every failure looks the same from outside. */
  async resetPasswordWithCode(input: ResetPasswordCodeInput): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(input.email) } });
    const usable =
      user &&
      user.isActive &&
      user.resetCodeHash &&
      user.resetCodeExpiry &&
      user.resetCodeExpiry > new Date() &&
      user.resetCodeAttempts < MAX_CODE_ATTEMPTS;

    if (!user || !usable || !user.resetCodeHash) {
      hashCode('reset', 'no-such-user', input.code); // same work whether or not the account exists
      throw new AppError(INVALID_CODE, 400);
    }
    if (!codeMatches(user.resetCodeHash, 'reset', user.id, input.code)) {
      await recordWrongCode(user.id, 'reset');
      throw new AppError(INVALID_CODE, 400);
    }
    await this.applyNewPassword(user, input.newPassword);
  },

  /** Shared ending of both reset paths: new password, every link/code/session revoked, owner alerted. */
  async applyNewPassword(user: User, newPassword: string): Promise<void> {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        resetPasswordTokenHash: null,
        resetPasswordExpiry: null,
        resetCodeHash: null,
        resetCodeExpiry: null,
        resetCodeAttempts: 0,
        refreshTokenHash: null // invalidate the existing session
      }
    });
    notifyPasswordChanged(user.email);
  },

  /**
   * Google-only accounts can add a password. An account that already has one must prove it knows the
   * current password, so a stolen or left-open session cannot quietly take the account over.
   */
  async setPassword(userId: string, password: string, currentPassword?: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new AppError('User not found or inactive', 404);

    if (user.passwordHash) {
      if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
        throw new AppError('Your current password is not correct', 400);
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) }
    });
    notifyPasswordChanged(user.email);
  }
};
