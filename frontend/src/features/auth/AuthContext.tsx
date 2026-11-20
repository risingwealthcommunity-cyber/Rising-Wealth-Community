import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { authApi } from './auth.api';
import type { RegisterInput } from './auth.api';
import type { OtpChallenge, User } from './auth.types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Resolves with an OTP challenge for admins with 2FA, otherwise logs in and resolves with null. */
  login: (email: string, password: string) => Promise<OtpChallenge | null>;
  verifyOtp: (tempToken: string, otp: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<string>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await authApi.me();
      setUser(res.data?.user ?? null);
    } catch {
      setUser(null);
    }
  }, []);

  // Restore session on page load (also picks up the cookie set after Google login).
  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    if (res.requireOtp) return res.data as unknown as OtpChallenge;
    setUser(res.data?.user ?? null);
    return null;
  }, []);

  const verifyOtp = useCallback(async (tempToken: string, otp: string) => {
    const res = await authApi.verifyOtp(tempToken, otp);
    setUser(res.data?.user ?? null);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await authApi.register(input);
    return res.message ?? 'Account created. Please verify your email.';
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, verifyOtp, register, logout, refreshUser }),
    [user, loading, login, verifyOtp, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
