export type Package = 'TRAINEE' | 'PRO' | 'ELITE';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  photoUrl: string | null;
  /** Key of the preset avatar the member chose (a1..a12), or null for initials. */
  avatar: string | null;
  city: string | null;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
  package: Package;
  rank: string;
  referralCode: string;
  /** Share this to place a new member on your LEFT / RIGHT. Both exist from the moment the account does. */
  leftCode: string | null;
  rightCode: string | null;
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
