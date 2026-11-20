import { OAuth2Client } from 'google-auth-library';
import { config, isGoogleConfigured } from '../../config/env';
import { AppError } from '../../shared/errors/AppError';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  photoUrl?: string;
}

let client: OAuth2Client | null = null;

const getClient = (): OAuth2Client => {
  if (!isGoogleConfigured()) throw new AppError('Google login is not configured', 503);
  return (client ??= new OAuth2Client(
    config.googleAuth.clientId,
    config.googleAuth.clientSecret,
    config.googleAuth.callbackUrl
  ));
};

export const googleAuth = {
  getAuthorizationUrl: (state: string): string =>
    getClient().generateAuthUrl({ scope: ['openid', 'email', 'profile'], state }),

  async profileFromCode(code: string): Promise<GoogleProfile> {
    if (!code.trim()) throw new AppError('Google authentication failed', 401);

    try {
      const oauth = getClient();
      const { tokens } = await oauth.getToken(code);
      if (!tokens.id_token) throw new AppError('Google authentication failed', 401);

      const ticket = await oauth.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.googleAuth.clientId
      });
      const p = ticket.getPayload();

      if (!p?.sub || !p.email || !p.name || p.email_verified !== true) {
        throw new AppError('Google authentication failed: incomplete profile data', 401);
      }
      return { googleId: p.sub, email: p.email, name: p.name, photoUrl: p.picture };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Google authentication failed during code exchange', 401);
    }
  }
};
