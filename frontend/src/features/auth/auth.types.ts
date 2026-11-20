export type Package = 'TRAINEE' | 'PRO' | 'ELITE';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  photoUrl: string | null;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
  package: Package;
  rank: string;
  referralCode: string;
  sponsorId: string | null;
  parentId: string | null;
  leg: 'LEFT' | 'RIGHT' | null;
  hasPassword: boolean;
  createdAt: string;
}

/** Returned by login when the account is an admin with 2FA turned on. */
export interface OtpChallenge {
  tempToken: string;
  email: string;
  message: string;
}
