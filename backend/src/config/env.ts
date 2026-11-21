import dotenv from 'dotenv';

dotenv.config();

// Secure by default: if NODE_ENV is forgotten on a server we behave like production, never like development.
const nodeEnv = (process.env.NODE_ENV ?? 'production').trim();
if (!['development', 'test', 'production'].includes(nodeEnv)) {
  throw new Error('NODE_ENV must be development, test or production.');
}

const clean = (value: string | undefined): string => {
  let v = (value ?? '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v;
};

const required = (key: string, minLength = 1): string => {
  const value = clean(process.env[key]);
  if (!value) throw new Error(`Environment variable ${key} is required.`);
  if (value.length < minLength) {
    throw new Error(`${key} must be at least ${minLength} characters long.`);
  }
  return value;
};

const frontendUrl = clean(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

if (nodeEnv === 'production') {
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (/change-?me|example|secret123/i.test(clean(process.env[key]))) {
      throw new Error(`${key} still holds the placeholder from .env.example. Set a long random value before running in production.`);
    }
  }
}

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  /** Local convenience only: the fixed admin code 123456. Needs NODE_ENV=development AND this flag. */
  allowDevMasterOtp: process.env.ALLOW_DEV_MASTER_OTP === 'true',
  port: Number(process.env.PORT ?? 5000),
  databaseUrl: required('DATABASE_URL'),
  frontendUrl,
  jwt: {
    access: required('JWT_ACCESS_SECRET', 32),
    refresh: required('JWT_REFRESH_SECRET', 32)
  },
  /** Key for stored bank details. Set FIELD_ENCRYPTION_KEY so rotating the login secrets never makes them unreadable. */
  fieldKey: clean(process.env.FIELD_ENCRYPTION_KEY) || required('JWT_REFRESH_SECRET', 32),

  /** Email: Brevo HTTPS API if BREVO_API_KEY is set, otherwise Gmail SMTP. Dev falls back to console. */
  email: {
    user: clean(process.env.EMAIL_USER) || clean(process.env.SMTP_USER),
    pass: clean(process.env.EMAIL_PASS) || clean(process.env.SMTP_PASSWORD),
    fromName: clean(process.env.EMAIL_FROM_NAME) || 'RWC'
  },
  brevoApiKey: clean(process.env.BREVO_API_KEY),

  /** Google OAuth is optional: the routes answer 503 until these are set. */
  googleAuth: {
    clientId: clean(process.env.GOOGLE_CLIENT_ID),
    clientSecret: clean(process.env.GOOGLE_CLIENT_SECRET),
    callbackUrl: clean(process.env.GOOGLE_CALLBACK_URL) || 'http://localhost:5173/api/auth/google/callback'
  }
};

export const isGoogleConfigured = (): boolean =>
  Boolean(config.googleAuth.clientId && config.googleAuth.clientSecret);
