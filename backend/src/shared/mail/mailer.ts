import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../../config/env';

export interface OutboxItem {
  to: string;
  kind: 'verify' | 'reset' | 'otp';
  link?: string;
  otp?: string;
}

/** Test-only mailbox: lets integration tests read verification links without a mail server. */
export const outbox: OutboxItem[] = [];

const maskEmail = (email: string): string => {
  const [user, domain] = email.split('@');
  return domain ? `${user.slice(0, 2)}***@${domain}` : '[no-email]';
};

let transporter: Transporter | null = null;
const getTransporter = () =>
  (transporter ??= nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.email.user, pass: config.email.pass }
  }));

async function deliver(
  item: OutboxItem,
  mail: { subject: string; html: string }
): Promise<void> {
  if (config.nodeEnv === 'test') {
    outbox.push(item);
    return;
  }

  if (config.brevoApiKey) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.brevoApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: config.email.fromName, email: config.email.user },
        to: [{ email: item.to }],
        subject: mail.subject,
        htmlContent: mail.html
      })
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(data.message ?? `Brevo API error: ${res.statusText}`);
    }
    return;
  }

  if (config.email.user && config.email.pass) {
    await getTransporter().sendMail({
      from: `"${config.email.fromName}" <${config.email.user}>`,
      to: item.to,
      subject: mail.subject,
      html: mail.html
    });
    return;
  }

  if (!config.isProduction) {
    // No mail provider configured: print so local development still works.
    console.log(`\n[MAIL:dev] ${item.kind.toUpperCase()} for ${maskEmail(item.to)} -> ${item.link ?? item.otp}\n`);
    return;
  }

  throw new Error('Email provider is not configured');
}

export const sendVerificationEmail = (to: string, link: string) =>
  deliver(
    { to, kind: 'verify', link },
    {
      subject: 'Verify your email',
      html: `<h2>Welcome to RWC</h2>
        <p>Please verify your email to activate your account:</p>
        <p><a href="${link}">Verify email</a></p>
        <p>This link expires in 24 hours.</p>`
    }
  );

export const sendResetPasswordEmail = (to: string, link: string) =>
  deliver(
    { to, kind: 'reset', link },
    {
      subject: 'Password reset request',
      html: `<h2>Password reset</h2>
        <p>Click the link below to set a new password:</p>
        <p><a href="${link}">Reset password</a></p>
        <p>This link expires in 15 minutes. If you did not request this, ignore this email.</p>`
    }
  );

export const sendAdminLoginOtpEmail = (to: string, otp: string) =>
  deliver(
    { to, kind: 'otp', otp },
    {
      subject: 'Your admin login code',
      html: `<h2>Admin login verification</h2>
        <p>Your 6-digit code is:</p>
        <h1 style="letter-spacing:6px">${otp}</h1>
        <p>It expires in 10 minutes.</p>`
    }
  );
