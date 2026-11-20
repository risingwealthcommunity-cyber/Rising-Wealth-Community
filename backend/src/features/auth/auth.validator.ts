import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('Invalid email address').max(255, 'Email is too long');
const password = z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password is too long');

export const signupSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100, 'Name is too long'),
    email,
    phone: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Invalid 10-digit mobile number')
      .optional(),
    password,
    // RWC specific: every member joins under a sponsor, on the left or right leg.
    sponsorCode: z.string().trim().toUpperCase().min(4, 'Sponsor code is required').max(20),
    leg: z.enum(['LEFT', 'RIGHT']).default('LEFT')
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1, 'Password is required').max(128, 'Password is too long')
  })
  .strict();

export const emailOnlySchema = z.object({ email }).strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().regex(/^[a-fA-F0-9]{64}$/, 'Invalid or expired reset token'),
    newPassword: password
  })
  .strict();

export const setPasswordSchema = z
  .object({ password, confirmPassword: password, currentPassword: z.string().max(128).optional() })
  .strict()
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword']
  });

const sixDigits = z.string().trim().regex(/^\d{6}$/, 'The code must be 6 digits');

export const verifyEmailCodeSchema = z.object({ email, code: sixDigits }).strict();

export const resetPasswordCodeSchema = z.object({ email, code: sixDigits, newPassword: password }).strict();

export const verifyAdminOtpSchema = z
  .object({
    tempToken: z.string().trim().min(1, 'Temporary session token is required'),
    otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be a 6-digit numeric code')
  })
  .strict();

export const resendAdminOtpSchema = z
  .object({ tempToken: z.string().trim().min(1, 'Temporary session token is required') })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordCodeInput = z.infer<typeof resetPasswordCodeSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyAdminOtpInput = z.infer<typeof verifyAdminOtpSchema>;
