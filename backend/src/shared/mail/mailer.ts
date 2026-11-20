import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../../config/env';

export interface OutboxItem {
  to: string;
  kind: 'verify' | 'reset' | 'otp' | 'changed';
  link?: string;
  otp?: string;
  /** What the email says. Only filled in by the test mailbox. */
  subject?: string;
  html?: string;
  text?: string;
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
  mail: { subject: string; html: string; text?: string }
): Promise<void> {
  if (config.nodeEnv === 'test') {
    outbox.push({ ...item, subject: mail.subject, html: mail.html, text: mail.text });
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
        htmlContent: mail.html,
        textContent: mail.text
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
      html: mail.html,
      text: mail.text
    });
    return;
  }

  if (!config.isProduction) {
    // No mail provider configured: print so local development still works.
    console.log(`\n[MAIL:dev] ${item.kind.toUpperCase()} for ${maskEmail(item.to)} -> ${item.link ?? ''} ${item.otp ? `code ${item.otp}` : ''}\n`);
    return;
  }

  throw new Error('Email provider is not configured');
}

const BRAND = 'Rising Wealth Community';

/** One look for every email: table layout and inline styles, because mail apps ignore real CSS. */
const layout = (heading: string, preheader: string, body: string) => `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f4f5;font-family:Arial,Helvetica,sans-serif;color:#0b100c">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f5;padding:28px 12px">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e8e4d8">
    <tr><td style="background:#0b0803;padding:22px 28px;color:#f0c850;font-size:15px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">${BRAND}</td></tr>
    <tr><td style="padding:30px 28px 8px"><h1 style="margin:0 0 14px;font-size:22px;line-height:1.25">${heading}</h1>${body}</td></tr>
    <tr><td style="padding:8px 28px 28px;color:#7a7a72;font-size:12px;line-height:1.6;border-top:1px solid #f0ece0">
      Never share your codes or links with anyone. ${BRAND} will never ask you for them.
    </td></tr>
  </table>
</td></tr></table></body></html>`;

const para = (text: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#33382f">${text}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:22px 0"><a href="${href}" style="display:inline-block;padding:14px 30px;border-radius:999px;background:#e3aa2c;color:#1a1200;font-size:14px;font-weight:700;text-decoration:none">${label}</a></p>`;
const codeBox = (code: string) =>
  `<div style="margin:6px 0 18px;padding:16px 0;text-align:center;border:1px dashed #e3aa2c;border-radius:12px;background:#faf6e9;color:#1a1200;font:700 32px/1 'Courier New',monospace;letter-spacing:9px">${code}</div>`;
const linkFallback = (href: string) =>
  `<p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:#7a7a72">Button not working? Copy this address into your browser:<br><span style="word-break:break-all;color:#555">${href}</span></p>`;
const small = (text: string) => `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b6f66">${text}</p>`;

export const sendVerificationEmail = (to: string, link: string, code: string) =>
  deliver(
    { to, kind: 'verify', link, otp: code },
    {
      subject: `Verify your ${BRAND} account`,
      html: layout(
        'Verify your email',
        `Your code is ${code}`,
        para('Welcome! Confirm your email address to activate your account.') +
          button(link, 'Verify my email') +
          para('Prefer typing it? Enter this 6-digit code on the verification page:') +
          codeBox(code) +
          small('The code works for 10 minutes and the link for 24 hours. If you did not create this account, you can ignore this email.') +
          linkFallback(link)
      ),
      text: `Verify your ${BRAND} account\n\nOpen this link (valid 24 hours):\n${link}\n\nOr enter this code (valid 10 minutes): ${code}\n\nIf you did not create this account, ignore this email.`
    }
  );

export const sendResetPasswordEmail = (to: string, link: string, code: string) =>
  deliver(
    { to, kind: 'reset', link, otp: code },
    {
      subject: `Reset your ${BRAND} password`,
      html: layout(
        'Reset your password',
        `Your code is ${code}`,
        para('We got a request to reset the password of your account.') +
          button(link, 'Choose a new password') +
          para('Or enter this 6-digit code on the reset page:') +
          codeBox(code) +
          small('The code works for 10 minutes and the link for 15 minutes, and only once. If you did not ask for this, nothing has changed: you can ignore this email.') +
          linkFallback(link)
      ),
      text: `Reset your ${BRAND} password\n\nOpen this link (valid 15 minutes):\n${link}\n\nOr enter this code (valid 10 minutes): ${code}\n\nIf you did not ask for this, ignore this email. Nothing has changed.`
    }
  );

export const sendPasswordChangedEmail = (to: string) =>
  deliver(
    { to, kind: 'changed' },
    {
      subject: `Your ${BRAND} password was changed`,
      html: layout(
        'Your password was changed',
        'Security alert',
        para('The password of your account was just changed, and every device was signed out.') +
          para('If this was you, there is nothing more to do.') +
          small('If it was not you, reset your password right away and contact support.')
      ),
      text: `Your ${BRAND} password was changed and every device was signed out.\n\nIf this was not you, reset your password right away and contact support.`
    }
  );

export const sendAdminLoginOtpEmail = (to: string, otp: string) =>
  deliver(
    { to, kind: 'otp', otp },
    {
      subject: `Your ${BRAND} admin login code`,
      html: layout(
        'Admin login code',
        `Your code is ${otp}`,
        para('Enter this 6-digit code to finish logging in:') +
          codeBox(otp) +
          small('It expires in 10 minutes. If you did not just log in, change your password.')
      ),
      text: `Your ${BRAND} admin login code: ${otp}\n\nIt expires in 10 minutes. If you did not just log in, change your password.`
    }
  );
