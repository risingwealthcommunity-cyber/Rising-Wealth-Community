import { api } from '../../shared/api/apiClient';
import type { OtpChallenge, User } from './auth.types';

export interface RegisterInput {
  name: string;
  email: string;
  phone?: string;
  password: string;
  sponsorCode: string;
  leg: 'LEFT' | 'RIGHT';
}

export const authApi = {
  /** Creates an unverified account. The user must click the emailed link before logging in. */
  register: (body: RegisterInput) => api('/auth/signup', { method: 'POST', body }),
  verifyEmail: (token: string) => api(`/auth/verify-email/${encodeURIComponent(token)}`),
  resendVerification: (email: string) => api('/auth/resend-verification', { method: 'POST', body: { email } }),

  login: (body: { email: string; password: string }) =>
    api<{ user: User } & Partial<OtpChallenge>>('/auth/login', { method: 'POST', body }),
  verifyOtp: (tempToken: string, otp: string) =>
    api<{ user: User }>('/auth/verify-admin-otp', { method: 'POST', body: { tempToken, otp } }),
  resendOtp: (tempToken: string) => api('/auth/resend-admin-otp', { method: 'POST', body: { tempToken } }),

  logout: () => api('/auth/logout', { method: 'POST' }),
  me: () => api<{ user: User }>('/auth/me'),

  forgotPassword: (email: string) => api('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token: string, newPassword: string) =>
    api('/auth/reset-password', { method: 'POST', body: { token, newPassword } }),
  setPassword: (password: string, confirmPassword: string) =>
    api('/auth/password/set', { method: 'POST', body: { password, confirmPassword } })
};

/** Google sign-in is a full-page redirect handled by the backend. */
export const googleLoginUrl = (ref?: string, leg?: string): string => {
  const q = new URLSearchParams();
  if (ref) q.set('ref', ref);
  if (leg) q.set('leg', leg);
  const qs = q.toString();
  return `/api/auth/google${qs ? `?${qs}` : ''}`;
};
