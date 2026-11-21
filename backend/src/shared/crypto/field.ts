import crypto from 'crypto';
import { config } from '../../config/env';

/** AES-256-GCM for fields that must be readable again later (bank account numbers). The key is derived from a server secret. */
const key = () => Buffer.from(crypto.hkdfSync('sha256', config.jwt.refresh, 'rwc-field-salt', 'bank-details-v1', 32));

export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decryptField(stored: string): string {
  const raw = Buffer.from(stored, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
