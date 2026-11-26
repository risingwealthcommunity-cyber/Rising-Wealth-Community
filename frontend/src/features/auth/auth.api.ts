import { api, apiUrl } from '../../shared/api/apiClient';
import type { OtpChallenge, User } from './auth.types';

export interface RegisterInput {
  name: string;
  email: string;
  phone?: string;
  password: string;
  sponsorCode: string;
  leg: 'LEFT' | 'RIGHT';
}

export interface SponsorPreview {
  valid: boolean;
  /** First name only. */
  sponsorName?: string;
  /** LEFT / RIGHT for the new two-code scheme, null for an older referral code (the person picks the side). */
  leg?: 'LEFT' | 'RIGHT' | null;
}

export const authApi = {
  /** The company's own LEFT and RIGHT codes, for people who were not invited by anyone. */
  companyCodes: () => api<{ left: string | null; right: string | null }>('/auth/company-codes'),
  sponsorPreview: (code: string) => api<SponsorPreview>(`/auth/sponsor/${encodeURIComponent(code)}`),
  /** Creates an unverified account. The user must click the emailed link before logging in. */
  register: (body: RegisterInput) => api('/auth/signup', { method: 'POST', body }),
  verifyEmail: (token: string) => api(`/auth/verify-email/${encodeURIComponent(token)}`),
  verifyEmailCode: (email: string, code: string) => api('/auth/verify-email-code', { method: 'POST', body: { email, code } }),
  resendVerification: (email: string) => api('/auth/resend-verification', { method: 'POST', body: { email } }),

  login: (body: { email: string; password: string }) =>
    api<{ user: User } & Partial<OtpChallenge>>('/auth/login', { method: 'POST', body }),
  verifyOtp: (tempToken: string, otp: string) =>
    api<{ user: User }>('/auth/verify-admin-otp', { method: 'POST', body: { tempToken, otp } }),
  resendOtp: (tempToken: string) => api('/auth/resend-admin-otp', { method: 'POST', body: { tempToken } }),

  logout: () => api('/auth/logout', { method: 'POST' }),
  me: () => api<{ user: User }>('/auth/me'),

  forgotPassword: (email: string) => api('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPasswordWithCode: (email: string, code: string, newPassword: string) =>
    api('/auth/reset-password-code', { method: 'POST', body: { email, code, newPassword } }),
  resetPassword: (token: string, newPassword: string) =>
    api('/auth/reset-password', { method: 'POST', body: { token, newPassword } }),
  setPassword: (password: string, confirmPassword: string, currentPassword?: string) =>
    api('/auth/password/set', {
      method: 'POST',
      body: { password, confirmPassword, ...(currentPassword ? { currentPassword } : {}) }
    })
};

/** Google sign-in is a full-page redirect handled by the backend. */
export const googleLoginUrl = (ref?: string, leg?: string): string => {
  const q = new URLSearchParams();
  if (ref) q.set('ref', ref);
  if (leg) q.set('leg', leg);
  const qs = q.toString();
  return apiUrl(`/api/auth/google${qs ? `?${qs}` : ''}`);
};
