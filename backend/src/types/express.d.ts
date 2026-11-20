import { Role, Package } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        email: string;
        role: Role;
        package: Package;
        referralCode: string;
      };
    }
  }
}

export {};
