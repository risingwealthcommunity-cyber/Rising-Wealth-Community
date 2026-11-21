/**
 * End-to-end verification of the compensation plan against a REAL (throw-away) Postgres,
 * driven through the HTTP API exactly like the frontend does.
 * Run: npm run test:integration
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { Server } from 'node:http';

import net from 'node:net';

/** Ask the OS for a free port so reruns never collide with a leftover instance. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
let PG_PORT = 0;
// embedded-postgres is ESM-only; load it with a real dynamic import.
const esmImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
let pg: any;
let server: Server;
let base = '';
let dataDir = '';
let prisma: typeof import('../config/database').prisma;
let ip = 0;

class Client {
  cookies = new Map<string, string>();
  async call(method: string, url: string, body?: unknown) {
    const res = await fetch(base + url, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `10.1.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`, // unique IP per call: bypass rate limits
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
      },
      body: body ? JSON.stringify(body) : undefined
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      this.cookies.set(k, v.join('='));
    }
    const json = (await res.json().catch(() => ({}))) as any;
    return { status: res.status, json };
  }
}

const rupees = (s: string | number) => Math.round(Number(s) * 100) / 100;
let counter = 0;

let outbox: { to: string; kind: string; link?: string; otp?: string; subject?: string; html?: string; text?: string }[] = [];
let tokens: typeof import('../features/auth/auth.tokens');

const lastMail = (to: string, kind: string) => [...outbox].reverse().find((m) => m.to === to && m.kind === kind);
const tokenFromLink = (link: string) => link.split('/').pop()!;

/** Register, verify the email from the (captured) mail, and log in: what a real user does. */
async function signup(sponsorCode: string, leg: 'LEFT' | 'RIGHT', name = `user${++counter}`) {
  const c = new Client();
  const email = `${name}@test.com`.toLowerCase();
  const r = await c.call('POST', '/api/auth/signup', {
    name,
    email,
    password: 'Password123',
    sponsorCode,
    leg
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));

  const mail = lastMail(email, 'verify');
  assert.ok(mail?.link, 'verification email was not sent');
  const v = await c.call('GET', `/api/auth/verify-email/${tokenFromLink(mail!.link!)}`);
  assert.equal(v.status, 200, JSON.stringify(v.json));

  const l = await c.call('POST', '/api/auth/login', { email, password: 'Password123' });
  assert.equal(l.status, 200, JSON.stringify(l.json));
  return { c, user: l.json.data.user as { id: string; referralCode: string }, email };
}

async function balance(c: Client) {
  const r = await c.call('GET', '/api/wallet');
  return rupees(r.json.data.balance);
}

let admin: Client;

/** User requests a package, admin confirms it. */
let utrSeq = 0;
/** What a member sends with every payment: the transaction ID and a screenshot. */
const payProof = () => ({ reference: `UTR-BUY-${++utrSeq}-${Date.now()}`, fileName: 'pay.png', fileData: PNG.toString('base64') });

async function buy(c: Client, pkg: 'PRO' | 'ELITE') {
  const p = await c.call('POST', '/api/packages/purchase', { package: pkg, ...payProof() });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  const ok = await admin.call('POST', `/api/admin/purchases/${p.json.data.purchase.id}/confirm`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
}

before(async () => {
  PG_PORT = await freePort();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rwc-pg-'));
  const { default: EmbeddedPostgres } = await esmImport('embedded-postgres');
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: PG_PORT,
    persistent: false
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('rwc_test');

  const url = `postgresql://postgres:postgres@localhost:${PG_PORT}/rwc_test`;
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
  process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
  // The suite must not depend on whatever credentials a developer keeps in .env.
  process.env.GOOGLE_CLIENT_ID = '';
  process.env.GOOGLE_CLIENT_SECRET = '';

  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe'
  });

  ({ prisma } = await import('../config/database'));
  ({ outbox } = await import('../shared/mail/mailer'));
  tokens = await import('../features/auth/auth.tokens');
  const { default: app } = await import('../app');
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://localhost:${(server.address() as { port: number }).port}`;

  // Root user (same as `npm run seed`)
  const bcrypt = (await import('bcrypt')).default;
  await prisma.user.create({
    data: {
      name: 'Root',
      email: 'admin@test.com',
      passwordHash: await bcrypt.hash('Password123', 4),
      role: 'SUPER_ADMIN',
      package: 'ELITE',
      isVerified: true,
      referralCode: 'RWCROOT'
    }
  });
  admin = new Client();
  const l = await admin.call('POST', '/api/auth/login', { email: 'admin@test.com', password: 'Password123' });
  assert.equal(l.status, 200);
});

after(async () => {
  server?.close();
  await prisma?.$disconnect();
  await Promise.race([pg?.stop(), new Promise((r) => setTimeout(r, 15_000))]);
  // Windows can keep Postgres' files locked for a moment after it stops. Retry, and never let a leftover
  // temp folder turn a passing run into a failing one.
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (err) {
    console.warn(`(could not remove the temp database folder ${dataDir}: ${(err as NodeJS.ErrnoException).code})`);
  }
});

// ---------------------------------------------------------------- AUTH

test('auth: signup rejects invalid sponsor code and short password', async () => {
  const c = new Client();
  const bad = await c.call('POST', '/api/auth/signup', {
    name: 'X Y', email: 'x@test.com', password: 'Password123', sponsorCode: 'NOPE1234'
  });
  assert.equal(bad.status, 400);
  const weak = await c.call('POST', '/api/auth/signup', {
    name: 'X Y', email: 'x@test.com', password: 'short', sponsorCode: 'RWCROOT'
  });
  assert.equal(weak.status, 400);
});

test('auth: signup issues NO session; login blocked until email verified; link is single-use; placement happens on verify', async () => {
  const c = new Client();
  const email = 'verifyme@test.com';
  const r = await c.call('POST', '/api/auth/signup', {
    name: 'Verify Me', email, password: 'Password123', sponsorCode: 'RWCROOT', leg: 'RIGHT'
  });
  assert.equal(r.status, 201);
  assert.equal(c.cookies.size, 0, 'signup must not log the user in');
  assert.equal(r.json.data, undefined);

  // unverified: not in the binary tree yet, cannot log in even with the right password
  let row = await prisma.user.findUniqueOrThrow({ where: { email } });
  assert.equal(row.isVerified, false);
  assert.equal(row.parentId, null);
  const early = await c.call('POST', '/api/auth/login', { email, password: 'Password123' });
  assert.equal(early.status, 403);
  assert.match(early.json.message, /verify your email/i);
  // a wrong password is still a generic 401 (does not leak verification state)
  assert.equal((await c.call('POST', '/api/auth/login', { email, password: 'WrongPass123' })).status, 401);

  const link = lastMail(email, 'verify')!.link!;
  assert.equal((await c.call('GET', `/api/auth/verify-email/${tokenFromLink(link)}`)).status, 200);
  assert.equal((await c.call('GET', `/api/auth/verify-email/${tokenFromLink(link)}`)).status, 400); // single-use

  row = await prisma.user.findUniqueOrThrow({ where: { email } });
  assert.equal(row.isVerified, true);
  assert.equal(row.leg, 'RIGHT');
  assert.ok(row.parentId, 'placed in the binary tree after verification');
  assert.equal((await c.call('POST', '/api/auth/login', { email, password: 'Password123' })).status, 200);
});

test('auth: forged / malformed verification tokens are rejected', async () => {
  const c = new Client();
  assert.equal((await c.call('GET', '/api/auth/verify-email/' + 'a'.repeat(64))).status, 400);
  assert.equal((await c.call('GET', '/api/auth/verify-email/garbage')).status, 400);
});

test('auth: duplicate email signup is silent (no enumeration) and creates nothing', async () => {
  await signup('RWCROOT', 'LEFT', 'dupuser');
  const before = await prisma.user.count();
  const mails = outbox.length;
  const r = await new Client().call('POST', '/api/auth/signup', {
    name: 'Dup', email: 'dupuser@test.com', password: 'Password123', sponsorCode: 'RWCROOT'
  });
  assert.equal(r.status, 201);
  assert.equal(await prisma.user.count(), before);
  assert.equal(outbox.length, mails);
});

test('auth: resend verification replaces the old link; unknown / verified emails get no mail', async () => {
  const c = new Client();
  const email = 'resend@test.com';
  await c.call('POST', '/api/auth/signup', { name: 'Re Send', email, password: 'Password123', sponsorCode: 'RWCROOT' });
  const first = lastMail(email, 'verify')!.link!;

  await ageEmails(email); // the first email "went out" two minutes ago, so a resend is allowed
  assert.equal((await c.call('POST', '/api/auth/resend-verification', { email })).status, 200);
  const second = lastMail(email, 'verify')!.link!;
  assert.notEqual(first, second);
  assert.equal((await c.call('GET', `/api/auth/verify-email/${tokenFromLink(first)}`)).status, 400);
  assert.equal((await c.call('GET', `/api/auth/verify-email/${tokenFromLink(second)}`)).status, 200);

  const mails = outbox.length;
  await c.call('POST', '/api/auth/resend-verification', { email }); // already verified
  await c.call('POST', '/api/auth/resend-verification', { email: 'nobody@test.com' });
  assert.equal(outbox.length, mails);
});

test('auth: me -> refresh rotation -> replay rejected -> logout kills the session', async () => {
  const { c } = await signup('RWCROOT', 'LEFT', 'authuser');
  const me = await c.call('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.data.user.package, 'TRAINEE');
  assert.equal(me.json.data.user.hasPassword, true);
  assert.equal(me.json.data.user.passwordHash, undefined);

  const oldRefresh = c.cookies.get('refreshToken')!;
  assert.equal((await c.call('POST', '/api/auth/refresh')).status, 200);
  assert.notEqual(c.cookies.get('refreshToken'), oldRefresh);

  const replay = new Client();
  replay.cookies.set('refreshToken', oldRefresh);
  assert.equal((await replay.call('POST', '/api/auth/refresh')).status, 401); // rotated token is dead

  const live = c.cookies.get('refreshToken')!;
  assert.equal((await c.call('POST', '/api/auth/logout')).status, 200);
  const after = new Client();
  after.cookies.set('refreshToken', live);
  assert.equal((await after.call('POST', '/api/auth/refresh')).status, 401); // logout revoked it
});

test('auth: forgot/reset password end to end', async () => {
  const { c, email } = await signup('RWCROOT', 'LEFT', 'resetme');
  const oldRefresh = c.cookies.get('refreshToken')!;

  const mails = outbox.length;
  const unknown = await new Client().call('POST', '/api/auth/forgot-password', { email: 'ghost@test.com' });
  assert.equal(unknown.status, 200); // same answer as for a real account
  assert.equal(outbox.length, mails);

  const f = await new Client().call('POST', '/api/auth/forgot-password', { email });
  assert.equal(f.status, 200);
  assert.equal(f.json.devResetToken, undefined);
  await new Promise((r) => setTimeout(r, 100)); // mail is sent in the background
  const resetToken = tokenFromLink(lastMail(email, 'reset')!.link!);

  const reset = (token: string, newPassword: string) =>
    new Client().call('POST', '/api/auth/reset-password', { token, newPassword });
  assert.equal((await reset('x'.repeat(64), 'NewPassword1')).status, 400);
  assert.equal((await reset(resetToken, 'NewPassword1')).status, 200);
  assert.equal((await reset(resetToken, 'Another12345')).status, 400); // single-use

  assert.equal((await new Client().call('POST', '/api/auth/login', { email, password: 'Password123' })).status, 401);
  assert.equal((await new Client().call('POST', '/api/auth/login', { email, password: 'NewPassword1' })).status, 200);

  const stale = new Client();
  stale.cookies.set('refreshToken', oldRefresh);
  assert.equal((await stale.call('POST', '/api/auth/refresh')).status, 401); // old session invalidated
});

test('auth: admin 2FA OTP (ENABLE_ADMIN_2FA=true)', async () => {
  process.env.ENABLE_ADMIN_2FA = 'true';
  try {
    const c = new Client();
    const l = await c.call('POST', '/api/auth/login', { email: 'admin@test.com', password: 'Password123' });
    assert.equal(l.status, 200);
    assert.equal(l.json.requireOtp, true);
    assert.equal(c.cookies.size, 0, 'no session before the OTP is verified');
    const { tempToken } = l.json.data;
    assert.ok(l.json.data.email.includes('***@')); // masked

    const otp = lastMail('admin@test.com', 'otp')!.otp!;
    const wrong = otp === '000000' ? '111111' : '000000';
    assert.equal((await c.call('POST', '/api/auth/verify-admin-otp', { tempToken, otp: wrong })).status, 400);
    assert.equal((await c.call('POST', '/api/auth/verify-admin-otp', { tempToken, otp: '123456' })).status, 400); // dev master OTP is dev-only
    assert.equal((await c.call('POST', '/api/auth/resend-admin-otp', { tempToken })).status, 429); // too soon

    const ok = await c.call('POST', '/api/auth/verify-admin-otp', { tempToken, otp });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal((await c.call('GET', '/api/admin/purchases')).status, 200);
    // OTP is single-use
    assert.equal((await new Client().call('POST', '/api/auth/verify-admin-otp', { tempToken, otp })).status, 400);

    // normal users are not affected by admin 2FA
    const u = await signup('RWCROOT', 'LEFT', 'no2fa');
    assert.ok(u.c.cookies.get('accessToken'));
  } finally {
    process.env.ENABLE_ADMIN_2FA = 'false';
  }
});

test('auth: set password for a Google-only account', async () => {
  const root = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.com' } });
  const user = await prisma.user.create({
    data: {
      name: 'G User', email: 'guser@test.com', googleId: 'g-123', isVerified: true,
      referralCode: 'RWCGUSER1', sponsorId: root.id
    }
  });
  assert.equal((await new Client().call('POST', '/api/auth/login', { email: user.email, password: 'Password123' })).status, 401); // no password yet

  const bearer = `Bearer ${tokens.signAccessToken(user.id, user.role)}`;
  const setPassword = async (body: unknown) =>
    (await fetch(base + '/api/auth/password/set', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${(ip++ % 250) + 1}`, authorization: bearer },
      body: JSON.stringify(body)
    })).status;

  assert.equal(await setPassword({ password: 'Password123', confirmPassword: 'Different123' }), 400);
  assert.equal(await setPassword({ password: 'Password123', confirmPassword: 'Password123' }), 200);
  assert.equal((await new Client().call('POST', '/api/auth/login', { email: user.email, password: 'Password123' })).status, 200);
  assert.equal((await new Client().call('POST', '/api/auth/password/set', { password: 'Password123', confirmPassword: 'Password123' })).status, 401);
});

// ---------------------------------------------------------------- SECURITY

/** A request with an arbitrary Authorization header and no cookies. */
const withBearer = async (token: string, method: string, url: string, body?: unknown) => {
  const res = await fetch(base + url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.7.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
      authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
};

test('SECURITY: the admin 2FA temp token cannot be used as a login session (no skipping the code)', async () => {
  process.env.ENABLE_ADMIN_2FA = 'true';
  try {
    const l = await new Client().call('POST', '/api/auth/login', { email: 'admin@test.com', password: 'Password123' });
    assert.equal(l.json.requireOtp, true);
    const { tempToken } = l.json.data;

    // knowing only the password must not be enough to reach anything
    assert.equal((await withBearer(tempToken, 'GET', '/api/auth/me')).status, 401);
    assert.equal((await withBearer(tempToken, 'GET', '/api/admin/purchases')).status, 401);
    assert.equal((await withBearer(tempToken, 'GET', '/api/wallet')).status, 401);
  } finally {
    process.env.ENABLE_ADMIN_2FA = 'false';
  }
});

test('SECURITY: only tokens issued as access tokens are accepted', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const root = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.com' } });
  const secret = process.env.JWT_ACCESS_SECRET!;

  // a real access token works
  assert.equal((await withBearer(tokens.signAccessToken(root.id, root.role), 'GET', '/api/auth/me')).status, 200);
  // a token signed with the right secret but without the access type does not
  assert.equal((await withBearer(jwt.sign({ userId: root.id, role: root.role }, secret, { expiresIn: 600 }), 'GET', '/api/auth/me')).status, 401);
  assert.equal((await withBearer(jwt.sign({ userId: root.id, typ: 'refresh' }, secret, { expiresIn: 600 }), 'GET', '/api/auth/me')).status, 401);
  // a token signed with the wrong secret does not
  assert.equal((await withBearer(jwt.sign({ userId: root.id, typ: 'access' }, 'x'.repeat(40), { expiresIn: 600 }), 'GET', '/api/auth/me')).status, 401);
  // alg "none" is refused
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ userId: root.id, typ: 'access' })).toString('base64url')}.`;
  assert.equal((await withBearer(none, 'GET', '/api/auth/me')).status, 401);
});

test('SECURITY: an admin one-time code can only be guessed a few times', async () => {
  process.env.ENABLE_ADMIN_2FA = 'true';
  try {
    const c = new Client();
    const l = await c.call('POST', '/api/auth/login', { email: 'admin@test.com', password: 'Password123' });
    const { tempToken } = l.json.data;
    const otp = lastMail('admin@test.com', 'otp')!.otp!;
    const wrong = otp === '000000' ? '111111' : '000000';

    for (let i = 1; i <= 4; i++) {
      assert.equal((await c.call('POST', '/api/auth/verify-admin-otp', { tempToken, otp: wrong })).status, 400, `attempt ${i}`);
    }
    // the fifth wrong guess burns the code: even the right one no longer works
    assert.equal((await c.call('POST', '/api/auth/verify-admin-otp', { tempToken, otp: wrong })).status, 429);
    assert.notEqual((await c.call('POST', '/api/auth/verify-admin-otp', { tempToken, otp })).status, 200);
    assert.equal(c.cookies.size, 0, 'no session was ever issued');

    // a fresh login brings a fresh code and a fresh allowance
    const again = await c.call('POST', '/api/auth/login', { email: 'admin@test.com', password: 'Password123' });
    const otp2 = lastMail('admin@test.com', 'otp')!.otp!;
    const ok = await c.call('POST', '/api/auth/verify-admin-otp', { tempToken: again.json.data.tempToken, otp: otp2 });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
  } finally {
    process.env.ENABLE_ADMIN_2FA = 'false';
  }
});

test('SECURITY: signing in with Google never creates an account; only a referral signup does', async () => {
  const { authService } = await import('../features/auth/auth.service');
  const { googleAuth } = await import('../features/auth/auth.google');
  const original = googleAuth.profileFromCode;
  const fresh = { googleId: 'g-new-1', email: 'brandnew@test.com', name: 'Brand New' };
  try {
    googleAuth.profileFromCode = async () => fresh;

    // login page: no referral => refused, nothing stored
    await assert.rejects(() => authService.handleGoogleLogin('code'), /ACCOUNT_NOT_FOUND/);
    assert.equal(await prisma.user.count({ where: { email: fresh.email } }), 0);

    // register link with a bad sponsor => refused too
    await assert.rejects(() => authService.handleGoogleLogin('code', { sponsorCode: 'NOPE1234', leg: 'LEFT' }), /SPONSOR_REQUIRED/);
    assert.equal(await prisma.user.count({ where: { email: fresh.email } }), 0);

    // register link with a real sponsor => the account is created and placed
    const session = await authService.handleGoogleLogin('code', { sponsorCode: 'RWCROOT', leg: 'LEFT' });
    assert.equal(session.user.email, fresh.email);
    assert.equal(await prisma.user.count({ where: { email: fresh.email } }), 1);

    // from then on the same person simply logs in (no referral needed)
    const again = await authService.handleGoogleLogin('code');
    assert.equal(again.user.id, session.user.id);
  } finally {
    googleAuth.profileFromCode = original;
  }
});

test('SECURITY: Google cannot be used to inherit a password someone else set on your email', async () => {
  const { authService } = await import('../features/auth/auth.service');
  const { googleAuth } = await import('../features/auth/auth.google');
  const original = googleAuth.profileFromCode;
  try {
    // an attacker registers the victim's email with their own password and never verifies it
    const victimEmail = 'victim.prehijack@test.com';
    const attacker = new Client();
    const r = await attacker.call('POST', '/api/auth/signup', {
      name: 'Attacker', email: victimEmail, password: 'AttackerPass1', sponsorCode: 'RWCROOT', leg: 'LEFT'
    });
    assert.equal(r.status, 201);
    assert.equal((await attacker.call('POST', '/api/auth/login', { email: victimEmail, password: 'AttackerPass1' })).status, 403); // unverified

    // the real owner signs in with Google
    googleAuth.profileFromCode = async () => ({ googleId: 'g-victim-1', email: victimEmail, name: 'Victim' });
    const session = await authService.handleGoogleLogin('code');
    assert.equal(session.user.email, victimEmail);

    // the attacker's password is gone for good
    const login = await new Client().call('POST', '/api/auth/login', { email: victimEmail, password: 'AttackerPass1' });
    assert.equal(login.status, 401);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: victimEmail } });
    assert.equal(row.passwordHash, null);
    assert.equal(row.isVerified, true);
  } finally {
    googleAuth.profileFromCode = original;
  }
});

test('SECURITY: changing a password needs the current one', async () => {
  const { c, email } = await signup('RWCROOT', 'RIGHT', 'pwchange');
  const change = (body: unknown) => c.call('POST', '/api/auth/password/set', body);

  // no current password / wrong current password
  assert.equal((await change({ password: 'NewPassword123', confirmPassword: 'NewPassword123' })).status, 400);
  assert.equal((await change({ password: 'NewPassword123', confirmPassword: 'NewPassword123', currentPassword: 'WrongPassword1' })).status, 400);
  assert.equal((await new Client().call('POST', '/api/auth/login', { email, password: 'Password123' })).status, 200, 'old password still works');

  // correct current password
  const ok = await change({ password: 'NewPassword123', confirmPassword: 'NewPassword123', currentPassword: 'Password123' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await new Client().call('POST', '/api/auth/login', { email, password: 'NewPassword123' })).status, 200);
  assert.equal((await new Client().call('POST', '/api/auth/login', { email, password: 'Password123' })).status, 401);
});

test('SECURITY: state-changing requests from an unknown website origin are refused (CSRF)', async () => {
  const post = async (origin: string | undefined) =>
    (await fetch(base + '/api/auth/logout', {
      method: 'POST',
      headers: { 'x-forwarded-for': `10.8.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`, ...(origin ? { origin } : {}) }
    })).status;

  assert.equal(await post('https://evil.example'), 403);
  assert.equal(await post('http://localhost:4173'), 403); // not our frontend
  assert.equal(await post('http://localhost:5173'), 200); // our dev frontend
  assert.equal(await post(undefined), 200); // curl / server to server: not a browser cross-site request

  // reads are never blocked
  const get = await fetch(base + '/api/site/content', { headers: { origin: 'https://evil.example', 'x-forwarded-for': '10.8.250.250' } });
  assert.equal(get.status, 200);

  // a body-less admin action from another site is refused even with the admin's cookies
  const res = await fetch(base + '/api/admin/purchases/00000000-0000-0000-0000-000000000000/confirm', {
    method: 'POST',
    headers: {
      origin: 'https://evil.example',
      cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      'x-forwarded-for': '10.8.250.251'
    }
  });
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------- EMAIL CODES (verification + password reset)

/** Pretend the last verification / reset email went out two minutes ago (skips the one-per-minute rule). */
async function ageEmails(email: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  await prisma.user.update({
    where: { id: u.id },
    data: {
      emailVerifyExpiry: u.emailVerifyExpiry ? new Date(u.emailVerifyExpiry.getTime() - 2 * 60 * 1000) : null,
      resetPasswordExpiry: u.resetPasswordExpiry ? new Date(u.resetPasswordExpiry.getTime() - 2 * 60 * 1000) : null
    }
  });
}

const registerUnverified = async (name: string) => {
  const c = new Client();
  const email = `${name}@test.com`.toLowerCase();
  const r = await c.call('POST', '/api/auth/signup', { name, email, password: 'Password123', sponsorCode: 'RWCROOT', leg: 'LEFT' });
  assert.equal(r.status, 201);
  return { c, email, mail: lastMail(email, 'verify')! };
};

const wrongCodeFor = (code: string) => (code === '000000' ? '111111' : '000000');

test('EMAIL CODES: the verification email carries a link AND a 6-digit code', async () => {
  const { email, mail } = await registerUnverified('codeboth');
  assert.match(mail.otp!, /^\d{6}$/);
  assert.match(mail.link!, /\/verify-email\/[a-f0-9]{64}$/);

  const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
  assert.notEqual(stored.emailVerifyCodeHash, mail.otp, 'the code is never stored in clear');
  assert.ok(!JSON.stringify(stored).includes(mail.otp!), 'the code appears nowhere in the stored row');
  assert.ok(stored.emailVerifyCodeExpiry && stored.emailVerifyCodeExpiry.getTime() - Date.now() <= 10 * 60 * 1000 + 1000);
});

test('EMAIL CODES: verifying with the code activates the account, places it, and works only once', async () => {
  const { c, email, mail } = await registerUnverified('codeverify');
  const code = (body: unknown) => new Client().call('POST', '/api/auth/verify-email-code', body);

  assert.equal((await c.call('POST', '/api/auth/login', { email, password: 'Password123' })).status, 403);
  assert.equal((await code({ email, code: wrongCodeFor(mail.otp!) })).status, 400);
  assert.equal((await code({ email, code: 'abcdef' })).status, 400); // not even six digits
  assert.equal((await code({ email, code: mail.otp })).status, 200);

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  assert.equal(user.isVerified, true);
  assert.ok(user.parentId, 'placed in the binary tree on verification, like the link does');
  assert.equal(user.emailVerifyCodeHash, null);
  assert.equal(user.emailVerifyTokenHash, null, 'the link stops working as soon as the code was used');
  assert.equal((await c.call('POST', '/api/auth/login', { email, password: 'Password123' })).status, 200);

  assert.equal((await code({ email, code: mail.otp })).status, 400, 'single use');
  assert.equal((await new Client().call('GET', `/api/auth/verify-email/${tokenFromLink(mail.link!)}`)).status, 400);
});

test('EMAIL CODES: and the link still works, and then kills the code', async () => {
  const { email, mail } = await registerUnverified('linkkillscode');
  assert.equal((await new Client().call('GET', `/api/auth/verify-email/${tokenFromLink(mail.link!)}`)).status, 200);
  assert.equal((await new Client().call('POST', '/api/auth/verify-email-code', { email, code: mail.otp })).status, 400);
});

test('EMAIL CODES: a verification code can only be guessed 5 times, then it is burned', async () => {
  const { email, mail } = await registerUnverified('codeguess');
  const bad = wrongCodeFor(mail.otp!);
  const code = (c: string) => new Client().call('POST', '/api/auth/verify-email-code', { email, code: c });

  for (let i = 0; i < 5; i++) assert.equal((await code(bad)).status, 400);
  assert.equal((await code(mail.otp!)).status, 400, 'even the right code is refused after 5 wrong guesses');
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { email } })).isVerified, false);

  // a fresh email brings a fresh code and a fresh allowance
  await ageEmails(email);
  await new Client().call('POST', '/api/auth/resend-verification', { email });
  const fresh = lastMail(email, 'verify')!;
  assert.notEqual(fresh.otp, mail.otp);
  assert.equal((await code(fresh.otp!)).status, 200);
});

test('EMAIL CODES: a code is bound to its own account and its own email address', async () => {
  const a = await registerUnverified('codeowner_a');
  const b = await registerUnverified('codeowner_b');
  const code = (email: string, c: string) => new Client().call('POST', '/api/auth/verify-email-code', { email, code: c });

  assert.equal((await code(b.email, a.mail.otp!)).status, 400, "A's code does not open B's account");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: b.email } })).isVerified, false);
  assert.equal((await code(a.email, a.mail.otp!)).status, 200);
});

test('EMAIL CODES: a code cannot be used to reset a password, and a reset code cannot verify an email', async () => {
  const { c, email, mail } = await registerUnverified('crosspurpose');
  const asReset = await new Client().call('POST', '/api/auth/reset-password-code', { email, code: mail.otp, newPassword: 'Hacked12345' });
  assert.equal(asReset.status, 400);
  assert.equal((await c.call('POST', '/api/auth/login', { email, password: 'Password123' })).status, 403);

  await new Client().call('POST', '/api/auth/forgot-password', { email });
  await new Promise((r) => setTimeout(r, 100));
  const reset = lastMail(email, 'reset')!;
  assert.equal((await new Client().call('POST', '/api/auth/verify-email-code', { email, code: reset.otp })).status, 400);
});

test('EMAIL CODES: failures look identical for unknown, verified and wrong-code cases (no account enumeration)', async () => {
  const unverified = await registerUnverified('enumcheck');
  const verified = await signup('RWCROOT', 'LEFT', 'enumverified');
  const post = (email: string) => new Client().call('POST', '/api/auth/verify-email-code', { email, code: '123456' });

  const unknown = await post('nobody.at.all@test.com');
  const alreadyVerified = await post(verified.email);
  const wrong = await post(unverified.email);
  for (const r of [unknown, alreadyVerified, wrong]) {
    assert.equal(r.status, 400);
    assert.equal(r.json.message, unknown.json.message);
  }
});

test('EMAIL CODES: resending is limited to one email per minute per account', async () => {
  const { email } = await registerUnverified('resendlimit');
  const before = outbox.filter((m) => m.to === email && m.kind === 'verify').length;

  for (let i = 0; i < 4; i++) {
    const r = await new Client().call('POST', '/api/auth/resend-verification', { email });
    assert.equal(r.status, 200, 'the answer is the same, so nothing leaks');
  }
  assert.equal(outbox.filter((m) => m.to === email && m.kind === 'verify').length, before, 'no extra emails inside the minute');

  await ageEmails(email);
  await new Client().call('POST', '/api/auth/resend-verification', { email });
  assert.equal(outbox.filter((m) => m.to === email && m.kind === 'verify').length, before + 1);

  const r2 = await new Client().call('POST', '/api/auth/forgot-password', { email });
  assert.equal(r2.status, 200);
  await new Promise((r) => setTimeout(r, 100));
  const resets = () => outbox.filter((m) => m.to === email && m.kind === 'reset').length;
  const n = resets();
  await new Client().call('POST', '/api/auth/forgot-password', { email });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(resets(), n, 'reset emails are limited too');
});

test('EMAIL CODES: reset by code sets the password, signs everyone out, alerts the owner, and works once', async () => {
  const { c, email } = await signup('RWCROOT', 'LEFT', 'resetbycode');
  const oldRefresh = c.cookies.get('refreshToken')!;

  await new Client().call('POST', '/api/auth/forgot-password', { email });
  await new Promise((r) => setTimeout(r, 100));
  const mail = lastMail(email, 'reset')!;
  assert.match(mail.otp!, /^\d{6}$/);
  assert.match(mail.link!, /\/reset-password\/[a-f0-9]{64}$/);

  const reset = (body: unknown) => new Client().call('POST', '/api/auth/reset-password-code', body);
  assert.equal((await reset({ email, code: wrongCodeFor(mail.otp!), newPassword: 'NewPassword1' })).status, 400);
  assert.equal((await reset({ email, code: mail.otp, newPassword: 'short' })).status, 400, 'password rules still apply');
  assert.equal((await new Client().call('POST', '/api/auth/login', { email, password: 'Password123' })).status, 200, 'nothing changed yet');

  const before = outbox.filter((m) => m.to === email && m.kind === 'changed').length;
  assert.equal((await reset({ email, code: mail.otp, newPassword: 'NewPassword1' })).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(outbox.filter((m) => m.to === email && m.kind === 'changed').length, before + 1, 'the owner is told about the change');

  assert.equal((await reset({ email, code: mail.otp, newPassword: 'Another12345' })).status, 400, 'single use');
  assert.equal((await new Client().call('POST', '/api/auth/reset-password', { token: tokenFromLink(mail.link!), newPassword: 'Another12345' })).status, 400, 'the link died with the code');
  assert.equal((await new Client().call('POST', '/api/auth/login', { email, password: 'Password123' })).status, 401);
  assert.equal((await new Client().call('POST', '/api/auth/login', { email, password: 'NewPassword1' })).status, 200);

  const stale = new Client();
  stale.cookies.set('refreshToken', oldRefresh);
  assert.equal((await stale.call('POST', '/api/auth/refresh')).status, 401, 'old sessions are signed out');
});

test('EMAIL CODES: using the reset LINK also kills the code and alerts the owner', async () => {
  const { email } = await signup('RWCROOT', 'RIGHT', 'linkthencode');
  await new Client().call('POST', '/api/auth/forgot-password', { email });
  await new Promise((r) => setTimeout(r, 100));
  const mail = lastMail(email, 'reset')!;

  const before = outbox.filter((m) => m.to === email && m.kind === 'changed').length;
  assert.equal((await new Client().call('POST', '/api/auth/reset-password', { token: tokenFromLink(mail.link!), newPassword: 'ViaLink12345' })).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(outbox.filter((m) => m.to === email && m.kind === 'changed').length, before + 1);
  assert.equal((await new Client().call('POST', '/api/auth/reset-password-code', { email, code: mail.otp, newPassword: 'ViaCode12345' })).status, 400);
});

test('EMAIL CODES: a reset code can only be guessed 5 times, and unknown emails get the same answer', async () => {
  const { email } = await signup('RWCROOT', 'LEFT', 'resetguess');
  await new Client().call('POST', '/api/auth/forgot-password', { email });
  await new Promise((r) => setTimeout(r, 100));
  const mail = lastMail(email, 'reset')!;
  const reset = (c: string, who = email) => new Client().call('POST', '/api/auth/reset-password-code', { email: who, code: c, newPassword: 'NewPassword1' });

  for (let i = 0; i < 5; i++) assert.equal((await reset(wrongCodeFor(mail.otp!))).status, 400);
  assert.equal((await reset(mail.otp!)).status, 400, 'burned after 5 wrong guesses');
  assert.equal((await new Client().call('POST', '/api/auth/login', { email, password: 'Password123' })).status, 200, 'the password is untouched');

  const known = await reset('123456');
  const unknown = await reset('123456', 'ghost.account@test.com');
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.message, known.json.message);
});

test('EMAIL CODES: every email shows the link and code in both the HTML and the plain-text version, and responses never leak them', async () => {
  const { email, mail } = await registerUnverified('mailshape');
  assert.ok(mail.link && mail.otp && mail.html && mail.text);

  // verification email
  assert.match(mail.subject!, /Verify your .*account/);
  assert.ok(mail.html!.includes(`href="${mail.link}"`), 'HTML has the button link');
  assert.ok(mail.html!.includes(mail.otp!), 'HTML shows the code');
  assert.ok(mail.text!.includes(mail.link!) && mail.text!.includes(mail.otp!), 'plain text has both too');
  assert.ok(mail.html!.includes('Never share'), 'the security reminder is there');
  assert.ok(!/<script/i.test(mail.html!), 'no scripts in an email');

  // reset email + the change alert
  await ageEmails(email);
  const f = await new Client().call('POST', '/api/auth/forgot-password', { email });
  await new Promise((r) => setTimeout(r, 100));
  const reset = lastMail(email, 'reset')!;
  assert.match(reset.subject!, /Reset your .*password/);
  assert.ok(reset.html!.includes(`href="${reset.link}"`) && reset.html!.includes(reset.otp!));
  assert.ok(reset.text!.includes(reset.link!) && reset.text!.includes(reset.otp!));

  // the HTTP answers never carry a link or a code
  for (const body of [JSON.stringify(f.json)]) {
    assert.equal(body.includes(reset.otp!), false);
    assert.equal(body.includes('reset-password/'), false);
  }

  assert.equal((await new Client().call('POST', '/api/auth/reset-password', { token: tokenFromLink(reset.link!), newPassword: 'MailShape12345' })).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  const changed = lastMail(email, 'changed')!;
  assert.match(changed.subject!, /password was changed/);
  assert.ok(!changed.html!.includes('/reset-password/'), 'the alert carries no link an attacker could reuse');
  assert.ok(!changed.html!.includes('href='), 'the alert has no links at all');
});

// ---------------------------------------------------------------- SPONSOR CODES (one LEFT and one RIGHT code per member)

const codesOf = async (email: string) =>
  prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, name: true, leftCode: true, rightCode: true, referralCode: true, parentId: true, leg: true, sponsorId: true } });

test('SPONSOR CODES: every new account gets its own LEFT and RIGHT code the moment it is created', async () => {
  // not even verified yet: the codes exist from signup
  const c = new Client();
  const email = 'twocodes@test.com';
  assert.equal((await c.call('POST', '/api/auth/signup', { name: 'Two Codes', email, password: 'Password123', sponsorCode: 'RWCROOT', leg: 'LEFT' })).status, 201);
  const fresh = await codesOf(email);
  assert.match(fresh.leftCode!, /^RWCL[0-9A-F]{8}$/);
  assert.match(fresh.rightCode!, /^RWCR[0-9A-F]{8}$/);
  assert.notEqual(fresh.leftCode, fresh.rightCode);
  assert.ok(![fresh.leftCode, fresh.rightCode].includes(fresh.referralCode));

  // they come back to the member after logging in, and from /me
  const { user, c: me } = await signup('RWCROOT', 'RIGHT', 'twocodes2');
  assert.match((user as any).leftCode, /^RWCL/);
  assert.match((user as any).rightCode, /^RWCR/);
  const meRes = await me.call('GET', '/api/auth/me');
  assert.equal(meRes.json.data.user.leftCode, (user as any).leftCode);
  assert.equal(meRes.json.data.user.rightCode, (user as any).rightCode);
});

test('SPONSOR CODES: all codes are unique, enforced by the database', async () => {
  const a = await codesOf('twocodes@test.com');
  const b = await codesOf('twocodes2@test.com');
  assert.notEqual(a.leftCode, b.leftCode);
  assert.notEqual(a.rightCode, b.rightCode);
  await assert.rejects(() => prisma.user.update({ where: { id: b.id }, data: { leftCode: a.leftCode } }), /Unique constraint/);
  await assert.rejects(() => prisma.user.update({ where: { id: b.id }, data: { rightCode: a.rightCode } }), /Unique constraint/);

  // 40 accounts, 80 codes, no repeats
  const all = await prisma.user.findMany({ select: { leftCode: true, rightCode: true } });
  const codes = all.flatMap((u) => [u.leftCode, u.rightCode]).filter(Boolean) as string[];
  assert.equal(new Set(codes).size, codes.length);
});

test('SPONSOR CODES: the code alone decides the side (the leg field is ignored for LEFT / RIGHT codes)', async () => {
  const sponsor = await signup('RWCROOT', 'LEFT', 'sidesponsor');
  const s = await codesOf(sponsor.email);

  // a LEFT code with leg=RIGHT still goes LEFT
  const left = await signup(s.leftCode!, 'RIGHT', 'sideleft');
  const l = await codesOf(left.email);
  assert.equal(l.sponsorId, s.id);
  assert.equal(l.parentId, s.id);
  assert.equal(l.leg, 'LEFT');

  // a RIGHT code with leg=LEFT still goes RIGHT
  const right = await signup(s.rightCode!, 'LEFT', 'sideright');
  const r = await codesOf(right.email);
  assert.equal(r.sponsorId, s.id);
  assert.equal(r.parentId, s.id);
  assert.equal(r.leg, 'RIGHT');

  // codes are case-insensitive and tolerate stray spaces
  const sloppy = await signup(`  ${s.leftCode!.toLowerCase()} `, 'RIGHT', 'sidesloppy');
  const sl = await codesOf(sloppy.email);
  assert.equal(sl.sponsorId, s.id);
  assert.equal(sl.leg, 'LEFT'.length ? sl.leg : 'LEFT'); // spills down the left leg: same side, deeper
});

test('SPONSOR CODES: the older referral code still works and still takes the leg from the form', async () => {
  const sponsor = await signup('RWCROOT', 'LEFT', 'legacysponsor');
  const s = await codesOf(sponsor.email);
  const viaLegacy = await signup(s.referralCode, 'RIGHT', 'legacyjoin');
  const j = await codesOf(viaLegacy.email);
  assert.equal(j.sponsorId, s.id);
  assert.equal(j.parentId, s.id);
  assert.equal(j.leg, 'RIGHT');
});

test('SPONSOR CODES: an unknown or empty code is refused', async () => {
  const bad = (code: string) =>
    new Client().call('POST', '/api/auth/signup', { name: 'Nobody', email: `bad${Math.random().toString(36).slice(2, 8)}@test.com`, password: 'Password123', sponsorCode: code, leg: 'LEFT' });
  assert.equal((await bad('RWCLDEADBEEF')).status, 400);
  assert.equal((await bad('RWCRDEADBEEF')).status, 400);
  assert.equal((await bad('NOPE1234')).status, 400);
  assert.equal((await bad('   ')).status, 400);
});

test('SPONSOR CODES: the preview tells a visitor whose team a code opens, and nothing more', async () => {
  const sponsor = await signup('RWCROOT', 'LEFT', 'previewperson');
  const s = await codesOf(sponsor.email);
  await prisma.user.update({ where: { id: s.id }, data: { name: 'Priya Kumari Sharma' } });
  const preview = (code: string) => new Client().call('GET', `/api/auth/sponsor/${encodeURIComponent(code)}`);

  const left = await preview(s.leftCode!);
  assert.deepEqual(left.json.data, { valid: true, sponsorName: 'Priya', leg: 'LEFT' });
  const right = await preview(s.rightCode!.toLowerCase());
  assert.deepEqual(right.json.data, { valid: true, sponsorName: 'Priya', leg: 'RIGHT' });
  const legacy = await preview(s.referralCode);
  assert.deepEqual(legacy.json.data, { valid: true, sponsorName: 'Priya', leg: null });

  const unknown = await preview('RWCLFFFFFFFF');
  assert.deepEqual(unknown.json.data, { valid: false });
  for (const body of [JSON.stringify(left.json), JSON.stringify(right.json), JSON.stringify(legacy.json)]) {
    assert.ok(!body.includes('Kumari') && !body.includes('Sharma'), 'only the first name is shown');
    assert.ok(!body.includes('@') && !body.includes(s.id), 'no email or id');
  }
});

test('SPONSOR CODES: members created before the codes existed get them on first use', async () => {
  const root = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.com' } });
  const old = await prisma.user.create({
    data: { name: 'Old Member', email: 'oldmember@test.com', isVerified: true, referralCode: 'RWCOLD0001', sponsorId: root.id, passwordHash: 'x' }
  });
  assert.equal(old.leftCode, null);

  const res = await withBearer(tokens.signAccessToken(old.id, old.role), 'GET', '/api/auth/me');
  assert.equal(res.status, 200);
  assert.match(res.json.data.user.leftCode, /^RWCL[0-9A-F]{8}$/);
  assert.match(res.json.data.user.rightCode, /^RWCR[0-9A-F]{8}$/);

  // and they are saved, so the same codes come back next time
  const again = await withBearer(tokens.signAccessToken(old.id, old.role), 'GET', '/api/auth/me');
  assert.equal(again.json.data.user.leftCode, res.json.data.user.leftCode);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: old.id } })).leftCode, res.json.data.user.leftCode);
});

test('SPONSOR CODES: Google signup through a RIGHT code lands on that side and the new member gets codes too', async () => {
  const { authService } = await import('../features/auth/auth.service');
  const { googleAuth } = await import('../features/auth/auth.google');
  const original = googleAuth.profileFromCode;
  try {
    const sponsor = await signup('RWCROOT', 'LEFT', 'googlesponsor');
    const s = await codesOf(sponsor.email);

    googleAuth.profileFromCode = async () => ({ googleId: 'g-right-1', email: 'googleright@test.com', name: 'Google Right' });
    // the leg in the referral cookie says LEFT, the code says RIGHT: the code wins
    const session = await authService.handleGoogleLogin('code', { sponsorCode: s.rightCode!, leg: 'LEFT' });

    const row = await codesOf('googleright@test.com');
    assert.equal(row.sponsorId, s.id);
    assert.equal(row.parentId, s.id);
    assert.equal(row.leg, 'RIGHT');
    assert.match(row.leftCode!, /^RWCL/);
    assert.match(row.rightCode!, /^RWCR/);
    assert.equal(session.user.id, row.id);
  } finally {
    googleAuth.profileFromCode = original;
  }
});

test('auth: Google login answers 503 until it is configured', async () => {
  const res = await fetch(base + '/api/auth/google', { redirect: 'manual' });
  assert.equal(res.status, 503);
});

test('auth: non-admin cannot reach admin routes', async () => {
  const { c } = await signup('RWCROOT', 'LEFT');
  assert.equal((await c.call('GET', '/api/admin/purchases')).status, 403);
  assert.equal((await new Client().call('GET', '/api/admin/purchases')).status, 401);
});

// ---------------------------------------------------------------- SITE IMAGES (About section)

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Raw-body upload, the way the admin page sends a file. */
async function putImage(c: Client | null, key: string, body: Buffer, contentType: string) {
  const res = await fetch(`${base}/api/site/assets/${key}`, {
    method: 'PUT',
    headers: {
      'content-type': contentType,
      'x-forwarded-for': `10.2.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
      cookie: c ? [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') : ''
    },
    body: new Uint8Array(body)
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

test('site images: nothing is published until an admin uploads it', async () => {
  const list = await new Client().call('GET', '/api/site/assets');
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.data.assets, {});
  assert.equal((await new Client().call('GET', '/api/site/assets/about-image')).status, 404);
});

test('site images: only admins can upload or remove', async () => {
  const { c } = await signup('RWCROOT', 'LEFT');
  assert.equal((await putImage(null, 'about-image', PNG, 'image/png')).status, 401);
  assert.equal((await putImage(c, 'about-image', PNG, 'image/png')).status, 403);
  assert.equal((await new Client().call('DELETE', '/api/site/assets/about-image')).status, 401);
  assert.equal((await c.call('DELETE', '/api/site/assets/about-image')).status, 403);
});

test('site images: admin uploads, the public can read the exact bytes, replace and remove work', async () => {
  const up = await putImage(admin, 'certificate', PNG, 'image/png');
  assert.equal(up.status, 200, JSON.stringify(up.json));

  const list = await new Client().call('GET', '/api/site/assets');
  const url: string = list.json.data.assets.certificate.url;
  assert.match(url, /^\/api\/site\/assets\/certificate\?v=\d+$/);
  assert.equal(list.json.data.assets['about-image'], undefined);

  const img = await fetch(base + url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control') ?? '', /immutable/);
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);

  // Revalidation with the ETag costs no bytes.
  const again = await fetch(base + url, { headers: { 'if-none-match': img.headers.get('etag')! } });
  assert.equal(again.status, 304);

  // Replacing changes the versioned URL so browsers never show the stale file.
  await new Promise((r) => setTimeout(r, 15));
  assert.equal((await putImage(admin, 'certificate', PNG, 'image/png')).status, 200);
  const list2 = await new Client().call('GET', '/api/site/assets');
  assert.notEqual(list2.json.data.assets.certificate.url, url);

  assert.equal((await admin.call('DELETE', '/api/site/assets/certificate')).status, 200);
  assert.deepEqual((await new Client().call('GET', '/api/site/assets')).json.data.assets, {});
  assert.equal((await fetch(base + url)).status, 404);
});

test('site images: rejects non-images, SVG, wrong content-type, unknown keys and oversized files', async () => {
  const text = Buffer.from('<script>alert(1)</script>');
  // Right Content-Type, wrong bytes
  assert.equal((await putImage(admin, 'about-image', text, 'image/png')).status, 415);
  // PNG bytes under a type we do not accept (no multipart / SVG / text)
  assert.equal((await putImage(admin, 'about-image', PNG, 'image/svg+xml')).status, 415);
  assert.equal((await putImage(admin, 'about-image', PNG, 'text/plain')).status, 415);
  // Only the two known slots exist
  assert.equal((await putImage(admin, '../etc/passwd', PNG, 'image/png')).status, 404);
  assert.equal((await putImage(admin, 'random', PNG, 'image/png')).status, 404);
  // > 6 MB
  const big = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024 + 10)]);
  assert.equal((await putImage(admin, 'about-image', big, 'image/png')).status, 413);
  assert.deepEqual((await new Client().call('GET', '/api/site/assets')).json.data.assets, {});
});

// ---------------------------------------------------------------- SITE CONTENT (team, reviews, milestones, contact)

const putContent = (c: Client | null, name: string, body: unknown) =>
  (c ?? new Client()).call('PUT', `/api/site/content/${name}`, body);

test('site content: empty until an admin sets it; only admins can edit', async () => {
  const pub = await new Client().call('GET', '/api/site/content');
  assert.equal(pub.status, 200);
  assert.equal(pub.json.data.milestones, null);
  assert.equal(pub.json.data.team, null);
  assert.equal(pub.json.data.reviews, null);
  assert.equal(pub.json.data.contact, null);

  const { c } = await signup('RWCROOT', 'LEFT');
  const body = { items: [{ value: '9K+', label: 'Happy members' }] };
  assert.equal((await putContent(null, 'milestones', body)).status, 401);
  assert.equal((await putContent(c, 'milestones', body)).status, 403);
  assert.equal((await putContent(admin, 'nonsense', body)).status, 404);
});

test('site content: milestones and contact are validated and saved', async () => {
  const bad = [
    ['milestones', { items: [] }],
    ['milestones', { items: [{ value: '', label: 'x' }] }],
    ['milestones', { items: [{ value: 'x'.repeat(13), label: 'x' }] }],
    ['milestones', { items: Array.from({ length: 7 }, () => ({ value: '1', label: 'x' })) }],
    ['contact', { phone: 'call me', whatsapp: '', email: '', instagram: '', youtube: '', facebook: '', telegram: '' }],
    ['contact', { phone: '', whatsapp: '', email: 'not-an-email', instagram: '', youtube: '', facebook: '', telegram: '' }],
    ['contact', { phone: '', whatsapp: '', email: '', instagram: 'javascript:alert(1)', youtube: '', facebook: '', telegram: '' }],
    ['contact', { phone: '', whatsapp: '', email: '', instagram: '', youtube: '', facebook: '', telegram: '', formKey: 'bad key!' }]
  ] as const;
  for (const [name, body] of bad) {
    assert.equal((await putContent(admin, name, body)).status, 400, `${name} ${JSON.stringify(body)}`);
  }

  const ok = await putContent(admin, 'milestones', { items: [{ value: ' 9K+ ', label: 'Members' }, { value: 'Rs 27L+', label: 'Paid' }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.data.milestones, [{ value: '9K+', label: 'Members' }, { value: 'Rs 27L+', label: 'Paid' }]);

  const contact = { phone: '+91 98765 43210', whatsapp: '+91 98765 43210', email: 'hello@example.com', instagram: 'https://instagram.com/rwc', youtube: '', facebook: '', telegram: '', formKey: 'abcd1234-ef56-7890' };
  assert.equal((await putContent(admin, 'contact', contact)).status, 200);
  const pub = await new Client().call('GET', '/api/site/content');
  assert.deepEqual(pub.json.data.contact, contact);
  assert.equal(pub.json.data.milestones.length, 2);
});

test('site content: team members get ids, photos attach to saved members, removing a member removes the photo', async () => {
  const saved = await putContent(admin, 'team', {
    items: [
      { name: 'Asha', role: 'CEO', bio: 'Leads the company.' },
      { id: 'attacker-chosen', name: 'Ravi', role: 'Strategist', bio: '' }
    ]
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const [asha, ravi] = saved.json.data.team as { id: string; name: string }[];
  assert.match(asha.id, /^[a-f0-9]{10}$/);
  assert.match(ravi.id, /^[a-f0-9]{10}$/);
  assert.notEqual(ravi.id, 'attacker-chosen');

  // A photo can only go to a saved member.
  assert.equal((await putImage(admin, 'team-0123456789', PNG, 'image/png')).status, 404);
  assert.equal((await putImage(admin, `team-${asha.id}`, PNG, 'image/png')).status, 200);
  assert.equal((await putImage(admin, `team-${ravi.id}`, PNG, 'image/png')).status, 200);
  let pub = await new Client().call('GET', '/api/site/content');
  assert.ok(pub.json.data.assets[`team-${asha.id}`]);

  // Saving again keeps existing ids (and their photos); dropping Ravi deletes his photo.
  const again = await putContent(admin, 'team', { items: [{ id: asha.id, name: 'Asha S', role: 'CEO', bio: '' }] });
  assert.equal(again.json.data.team[0].id, asha.id);
  pub = await new Client().call('GET', '/api/site/content');
  assert.ok(pub.json.data.assets[`team-${asha.id}`], 'kept member keeps their photo');
  assert.equal(pub.json.data.assets[`team-${ravi.id}`], undefined, 'removed member photo is deleted');

  // Non-admins cannot upload member photos.
  const { c } = await signup('RWCROOT', 'RIGHT');
  assert.equal((await putImage(c, `team-${asha.id}`, PNG, 'image/png')).status, 403);
});

test('site content: review screenshots follow the same rules; slot images work for features and milestones', async () => {
  const saved = await putContent(admin, 'reviews', { items: [{ name: 'Karan', tag: 'Verified Member' }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const id = saved.json.data.reviews[0].id as string;
  assert.equal((await putImage(admin, `review-${id}`, PNG, 'image/png')).status, 200);
  assert.equal((await putImage(admin, 'feature-2', PNG, 'image/png')).status, 200);
  assert.equal((await putImage(admin, 'milestone-1', PNG, 'image/png')).status, 200);
  assert.equal((await putImage(admin, 'feature-9', PNG, 'image/png')).status, 404);

  let pub = await new Client().call('GET', '/api/site/content');
  for (const k of [`review-${id}`, 'feature-2', 'milestone-1']) assert.ok(pub.json.data.assets[k], k);

  // Shrinking milestones drops the images of the milestones that no longer exist.
  await putContent(admin, 'milestones', { items: [{ value: '1', label: 'a' }, { value: '2', label: 'b' }] });
  assert.equal((await putImage(admin, 'milestone-2', PNG, 'image/png')).status, 200);
  await putContent(admin, 'milestones', { items: [{ value: '1', label: 'a' }] });
  pub = await new Client().call('GET', '/api/site/content');
  assert.ok(pub.json.data.assets['milestone-1']);
  assert.equal(pub.json.data.assets['milestone-2'], undefined);

  // Emptying the reviews removes their screenshots too.
  await putContent(admin, 'reviews', { items: [] });
  pub = await new Client().call('GET', '/api/site/content');
  assert.equal(pub.json.data.assets[`review-${id}`], undefined);
});

test('binary placement: same leg spills down, one child per leg', async () => {
  const a = await signup('RWCROOT', 'RIGHT', 'placeA');
  const b = await signup('RWCROOT', 'RIGHT', 'placeB');
  const rows = await prisma.user.findMany({ where: { id: { in: [a.user.id, b.user.id] } } });
  const ra = rows.find((r) => r.id === a.user.id)!;
  const rb = rows.find((r) => r.id === b.user.id)!;
  assert.equal(rb.parentId, ra.id); // B spilled under A, not directly under root
  assert.equal(rb.sponsorId, (await prisma.user.findUniqueOrThrow({ where: { referralCode: 'RWCROOT' } })).id);
});

// ---------------------------------------------------------------- PACKAGES / INCOME

test('income: PRO sale pays sponsor 35% direct + L1 5%, grandsponsor L2 3%', async () => {
  const root = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.com' } })).id;
  const a = await signup('RWCROOT', 'LEFT', 'inc_a'); // sponsor: root
  await buy(a.c, 'PRO');

  const b = await signup(a.user.referralCode, 'LEFT', 'inc_b'); // sponsor: a
  const rootBefore = await balance(admin);
  const aBefore = await balance(a.c);
  await buy(b.c, 'PRO');

  assert.equal(rupees((await balance(a.c)) - aBefore), rupees(874.65 + 124.95)); // direct + L1
  assert.equal(rupees((await balance(admin)) - rootBefore), 74.97); // L2 (root is ELITE: unlocked)
  assert.ok(root);
});

test('income: direct is capped to sponsor package (PRO sponsor, ELITE sale)', async () => {
  const a = await signup('RWCROOT', 'LEFT', 'cap_a');
  await buy(a.c, 'PRO');
  const b = await signup(a.user.referralCode, 'LEFT', 'cap_b');
  const before = await balance(a.c);
  await buy(b.c, 'ELITE');
  // direct capped at 874.65 (35% of 2499), level-1 passive = 5% of 4999 = 249.95
  assert.equal(rupees((await balance(a.c)) - before), rupees(874.65 + 249.95));

  const excess = await prisma.ledgerEntry.findMany({
    where: { type: 'COMPANY_FUND', note: 'DIRECT_CAPPED_TO_SPONSOR_PACKAGE', sourceUserId: b.user.id }
  });
  assert.equal(excess.length, 1);
  assert.equal(rupees(excess[0].amount.toString()), rupees(1749.65 - 874.65));
});

test('income: PRO sponsor does not earn passive levels 8-12 (goes to company)', async () => {
  // chain of 9: u0 <- u1 <- ... <- u8, all PRO, then u8's downline buys at level 9 for u0
  const users: Awaited<ReturnType<typeof signup>>[] = [];
  let sponsor = 'RWCROOT';
  for (let i = 0; i < 9; i++) {
    const u = await signup(sponsor, 'LEFT', `deep${i}`);
    await buy(u.c, 'PRO');
    users.push(u);
    sponsor = u.user.referralCode;
  }
  const top = users[0];
  const before = await balance(top.c);
  const buyer = await signup(sponsor, 'LEFT', 'deepbuyer'); // sponsored by deep8 => deep0 (top) is level 9
  await buy(buyer.c, 'PRO');
  assert.equal(await balance(top.c), before); // level 9 is locked for PRO (PRO unlocks 1-7)
  const locked = await prisma.ledgerEntry.count({
    where: { type: 'COMPANY_FUND', sourceUserId: buyer.user.id, note: 'PASSIVE_LEVEL_LOCKED' }
  });
  assert.equal(locked, 2); // levels 8 (deep1) and 9 (deep0)
});

test('income: Trainee sponsor earns nothing from package sales', async () => {
  const t = await signup('RWCROOT', 'LEFT', 'trainee1');
  const b = await signup(t.user.referralCode, 'LEFT', 'trainee_b');
  await buy(b.c, 'PRO');
  assert.equal(await balance(t.c), 0);
  const me = await t.c.call('GET', '/api/team/summary');
  assert.equal(me.json.data.points.left, 0); // trainee gets no binary points
});

test('packages: no partial/duplicate/downgrade purchases', async () => {
  const u = await signup('RWCROOT', 'LEFT', 'rules');
  assert.equal((await u.c.call('POST', '/api/packages/purchase', { package: 'PRO', ...payProof() })).status, 201);
  assert.equal((await u.c.call('POST', '/api/packages/purchase', { package: 'ELITE', ...payProof() })).status, 409); // pending exists
  const pending = await admin.call('GET', '/api/admin/purchases?status=PENDING');
  const mine = pending.json.data.purchases.find((p: any) => p.user.email === 'rules@test.com');
  assert.equal(mine.amount, '2499');
  await admin.call('POST', `/api/admin/purchases/${mine.id}/confirm`);
  assert.equal((await u.c.call('POST', '/api/packages/purchase', { package: 'PRO', ...payProof() })).status, 400); // already PRO
  assert.equal((await u.c.call('POST', '/api/packages/purchase', { package: 'ELITE', ...payProof() })).status, 201); // upgrade
});

test('packages: confirming twice / concurrently pays only once', async () => {
  const a = await signup('RWCROOT', 'LEFT', 'race_a');
  await buy(a.c, 'PRO');
  const b = await signup(a.user.referralCode, 'LEFT', 'race_b');
  const p = await b.c.call('POST', '/api/packages/purchase', { package: 'PRO', ...payProof() });
  const before = await balance(a.c);
  const results = await Promise.all(
    [1, 2, 3].map(() => admin.call('POST', `/api/admin/purchases/${p.json.data.purchase.id}/confirm`))
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(rupees((await balance(a.c)) - before), rupees(874.65 + 124.95));
});

// ---------------------------------------------------------------- BINARY / RANK

test('rank: SILVER at 2:2 points (4 PRO per leg), one-time reward Rs 750, points reset', async () => {
  const lead = await signup('RWCROOT', 'LEFT', 'leader');
  await buy(lead.c, 'PRO');
  const code = lead.user.referralCode;

  // 3 PRO on each leg: 1.5 : 1.5 -> no rank yet
  for (let i = 0; i < 3; i++) {
    await buy((await signup(code, 'LEFT', `ll${i}`)).c, 'PRO');
    await buy((await signup(code, 'RIGHT', `lr${i}`)).c, 'PRO');
  }
  let t = (await lead.c.call('GET', '/api/team/summary')).json.data;
  assert.equal(t.rank, 'NONE');
  assert.deepEqual([t.points.left, t.points.right], [1.5, 1.5]);

  const before = await balance(lead.c);
  await buy((await signup(code, 'LEFT', 'll3')).c, 'PRO');
  // left reached 2:1.5 -> still needs right
  assert.equal((await lead.c.call('GET', '/api/team/summary')).json.data.rank, 'NONE');
  await buy((await signup(code, 'RIGHT', 'lr3')).c, 'PRO');

  t = (await lead.c.call('GET', '/api/team/summary')).json.data;
  assert.equal(t.rank, 'SILVER');
  assert.deepEqual([t.points.left, t.points.right], [0, 0]); // reset after rank
  assert.equal(t.nextRank.rank, 'GOLD');

  const rewards = await prisma.ledgerEntry.findMany({ where: { userId: lead.user.id, type: 'RANK_REWARD' } });
  assert.equal(rewards.length, 1);
  assert.equal(rupees(rewards[0].amount.toString()), 750);

  // 8 sales -> direct income for leader (35%+5%)... balance grew by 750 reward + direct/passive of the last 2 sales
  assert.ok((await balance(lead.c)) >= before + 750);
});

test('rank: a rank reward is never paid twice for the same points', async () => {
  const lead = await prisma.user.findUniqueOrThrow({ where: { email: 'leader@test.com' } });
  assert.equal(await prisma.ledgerEntry.count({ where: { userId: lead.id, type: 'RANK_REWARD' } }), 1);
});

// ---------------------------------------------------------------- DEMAT

test('demat: referrer + up to 5 passive levels (Trainees earn too)', async () => {
  const u1 = await signup('RWCROOT', 'LEFT', 'dm1');
  const u2 = await signup(u1.user.referralCode, 'LEFT', 'dm2');
  const u3 = await signup(u2.user.referralCode, 'LEFT', 'dm3'); // referrer
  const r = await admin.call('POST', '/api/admin/demat', {
    referrerEmail: u3.email,
    clientName: 'Client A',
    amount: 200
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(await balance(u3.c), 200);
  assert.equal(await balance(u2.c), 10); // L1 5%
  assert.equal(await balance(u1.c), 6); // L2 3%
});

// ---------------------------------------------------------------- POOLS

test('pools: close period pays within pools only, consumes matched points, second close pays nothing', async () => {
  const revRow = await prisma.packagePurchase.aggregate({
    where: { status: 'CONFIRMED' },
    _sum: { amount: true }
  });
  const revenue = Number(revRow._sum.amount);

  const sumBefore = await prisma.user.aggregate({ _sum: { walletBalance: true } });
  const closed = await admin.call('POST', '/api/admin/periods/close');
  assert.equal(closed.status, 201, JSON.stringify(closed.json));
  const p = closed.json.data.period;

  assert.equal(rupees(p.revenue), revenue);
  assert.equal(rupees(p.weeklyPool), rupees(revenue * 0.05));
  assert.equal(rupees(p.performancePool), rupees(revenue * 0.05));
  assert.equal(rupees(p.leadershipPool), rupees(revenue * 0.12));
  // never exceed pools
  assert.ok(Number(p.weeklyPaid) <= Number(p.weeklyPool));
  assert.ok(Number(p.performancePaid) <= Number(p.performancePool));
  assert.ok(Number(p.leadershipPaid) <= Number(p.leadershipPool));
  assert.ok(Number(p.leadershipPaid) > 0, 'SILVER leader with matched points should be paid');
  assert.ok(Number(p.weeklyPaid) > 0, 'root has >= 3 direct PRO sales');

  // wallet growth == total paid out
  const sumAfter = await prisma.user.aggregate({ _sum: { walletBalance: true } });
  const grown = Number(sumAfter._sum.walletBalance) - Number(sumBefore._sum.walletBalance);
  assert.equal(
    rupees(grown),
    rupees(Number(p.weeklyPaid) + Number(p.performancePaid) + Number(p.leadershipPaid))
  );

  // leader's matched points consumed (no reuse)
  const lead = await prisma.user.findUniqueOrThrow({ where: { email: 'leader@test.com' } });
  assert.equal(Math.min(lead.matchLeftHalf, lead.matchRightHalf), 0);

  // closing again immediately: new empty window, nothing paid
  const again = await admin.call('POST', '/api/admin/periods/close');
  assert.equal(again.status, 201);
  const p2 = again.json.data.period;
  assert.equal(Number(p2.revenue), 0);
  assert.equal(Number(p2.leadershipPaid) + Number(p2.weeklyPaid) + Number(p2.performancePaid), 0);
});

test('pools: Trainees and non-Silver users never receive leadership bonus', async () => {
  const rows = await prisma.ledgerEntry.findMany({
    where: { type: 'LEADERSHIP_BONUS' },
    include: { user: { select: { rank: true } } }
  });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.user!.rank !== 'NONE'));
  const trainees = await prisma.ledgerEntry.count({
    where: { type: { in: ['WEEKLY_BONUS', 'PERFORMANCE_BONUS', 'LEADERSHIP_BONUS'] }, user: { package: 'TRAINEE' } }
  });
  assert.equal(trainees, 0);
});

// ---------------------------------------------------------------- TEAM PERFORMANCE + LEADERSHIP BONUS

const bonusesOf = async (c: Client) => (await c.call('GET', '/api/team/bonuses')).json.data;
const rowOf = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });
/** A member with a paid package (only paid members earn binary bonuses) and their two codes. */
async function paidMember(sponsorCode: string, leg: 'LEFT' | 'RIGHT', name: string) {
  const m = await signup(sponsorCode, leg, name);
  await buy(m.c, 'PRO');
  const row = await rowOf(m.email);
  return { ...m, id: row.id, left: row.leftCode!, right: row.rightCode! };
}
const teamPaid = (c: Client) =>
  c.call('GET', '/api/wallet/transactions').then((r) =>
    (r.json.data.items as any[])
      .filter((e) => e.type === 'TEAM_PERFORMANCE_BONUS')
      .map((e) => rupees(e.amount))
      .sort((a, b) => a - b)
  );

test('TEAM BONUS: 2 new on the left + 2 new on the right pays Rs 750 straight into the wallet', async () => {
  const top = await paidMember('RWCROOT', 'LEFT', 'tb_top');
  const before = await balance(top.c);

  await signup(top.left, 'LEFT', 'tb_l1');
  await signup(top.right, 'LEFT', 'tb_r1');
  await signup(top.left, 'LEFT', 'tb_l2');
  let b = await bonusesOf(top.c);
  assert.equal(b.team.completed, 0, 'only 3 of 4 members so far');
  assert.deepEqual([b.team.pendingLeft, b.team.pendingRight], [2, 1]);
  assert.equal(await balance(top.c), before);

  await signup(top.right, 'LEFT', 'tb_r2');
  b = await bonusesOf(top.c);
  assert.equal(b.team.completed, 1);
  assert.equal(b.team.current.target, 2);
  assert.equal(b.team.current.members, 4);
  assert.deepEqual([b.team.pendingLeft, b.team.pendingRight], [0, 0]);
  assert.deepEqual([b.team.totalLeft, b.team.totalRight], [2, 2]);
  assert.equal(await balance(top.c), before + 750);
  assert.equal(b.history.length, 1);
  assert.equal(b.history[0].amount, '750.00');
  assert.equal(b.history[0].kind, 'TEAM');
  assert.equal(b.team.targets[0].status, 'DONE');
  assert.equal(b.team.targets[1].status, 'CURRENT');
  assert.equal(b.team.targets[2].status, 'LOCKED');
});

test('TEAM BONUS: the next target needs 4:4 FRESH members; the earlier 2:2 are never counted again', async () => {
  const top = await rowOf('tb_top@test.com');
  const topC = new Client();
  assert.equal((await topC.call('POST', '/api/auth/login', { email: 'tb_top@test.com', password: 'Password123' })).status, 200);
  const before = await balance(topC);

  for (let i = 1; i <= 3; i++) {
    await signup(top.leftCode!, 'LEFT', `tb2_l${i}`);
    await signup(top.rightCode!, 'LEFT', `tb2_r${i}`);
  }
  let b = await bonusesOf(topC);
  assert.equal(b.team.completed, 1, '3:3 fresh members is not enough for 4:4');
  assert.deepEqual([b.team.pendingLeft, b.team.pendingRight], [3, 3]);
  assert.equal(await balance(topC), before);

  await signup(top.leftCode!, 'LEFT', 'tb2_l4');
  b = await bonusesOf(topC);
  assert.equal(b.team.completed, 1, 'both sides are needed: 4 left but only 3 right');
  await signup(top.rightCode!, 'LEFT', 'tb2_r4');

  b = await bonusesOf(topC);
  assert.equal(b.team.completed, 2);
  assert.equal(await balance(topC), before + 1500);
  assert.deepEqual([b.team.pendingLeft, b.team.pendingRight], [0, 0]);
  assert.deepEqual([b.team.totalLeft, b.team.totalRight], [6, 6]);
  assert.equal(b.team.current.target, 3);
  assert.equal(b.team.current.reward, 3000);
  assert.deepEqual(await teamPaid(topC), [750, 1500]);
});

test('TEAM BONUS: the whole downline counts on the side it hangs from (not just direct referrals)', async () => {
  const top = await paidMember('RWCROOT', 'LEFT', 'dl_top');
  const b1 = await paidMember(top.left, 'LEFT', 'dl_b1'); // direct, LEFT
  await signup(b1.left, 'LEFT', 'dl_c1'); // b1's own referrals sit deeper in top's LEFT
  await signup(b1.right, 'LEFT', 'dl_c2');
  const topRow = await rowOf('dl_top@test.com');
  assert.deepEqual([topRow.teamLeftTotal, topRow.teamRightTotal], [3, 0]);
  for (const e of ['dl_c1', 'dl_c2']) {
    const m = await rowOf(`${e}@test.com`);
    assert.notEqual(m.parentId, topRow.id, 'they are placed under b1, not directly under top');
  }
  // b1 has his own independent tree: his left and right each got one
  const b1Row = await rowOf('dl_b1@test.com');
  assert.deepEqual([b1Row.teamLeftTotal, b1Row.teamRightTotal], [1, 1]);
});

test('TEAM BONUS: a Trainee earns nothing, and an unverified signup is not counted', async () => {
  const trainee = await signup('RWCROOT', 'LEFT', 'tr_top');
  const t = await rowOf('tr_top@test.com');
  await signup(t.leftCode!, 'LEFT', 'tr_l1');
  await signup(t.rightCode!, 'LEFT', 'tr_r1');
  const after = await rowOf('tr_top@test.com');
  assert.deepEqual([after.teamLeftTotal, after.teamRightTotal], [0, 0]);
  assert.equal(await balance(trainee.c), 0);

  // signed up but never verified: no placement, so nothing counted for the sponsor
  const paid = await paidMember('RWCROOT', 'LEFT', 'uv_top');
  await new Client().call('POST', '/api/auth/signup', {
    name: 'Unverified',
    email: 'uv_new@test.com',
    password: 'Password123',
    sponsorCode: paid.left
  });
  assert.equal((await rowOf('uv_top@test.com')).teamLeftTotal, 0);
});

test('TEAM BONUS: members joining at the same moment can never pay a target twice or lose a count', async () => {
  const top = await paidMember('RWCROOT', 'LEFT', 'cc_top');
  await Promise.all([
    ...[1, 2, 3].map((i) => signup(top.left, 'LEFT', `cc_l${i}`)),
    ...[1, 2, 3].map((i) => signup(top.right, 'LEFT', `cc_r${i}`))
  ]);
  const row = await rowOf('cc_top@test.com');
  assert.deepEqual([row.teamLeftTotal, row.teamRightTotal], [3, 3]);
  assert.equal(row.teamTargetsDone, 1);
  assert.deepEqual([row.teamLeftNew, row.teamRightNew], [1, 1]);
  assert.deepEqual(await teamPaid(top.c), [750]);
});

test('TEAM BONUS: a placement never changes, and nobody has an endpoint to move a member', async () => {
  const top = await rowOf('tb_top@test.com');
  const kids = await prisma.user.findMany({ where: { parentId: top.id }, select: { id: true, leg: true, parentId: true } });
  const again = await signup(top.leftCode!, 'RIGHT', 'fix_l1'); // asks for RIGHT with a LEFT code: stays LEFT
  const a = await rowOf(again.email);
  assert.equal(a.sponsorId, top.id);
  assert.equal(a.leg, 'LEFT');
  const after = await prisma.user.findMany({ where: { id: { in: kids.map((k) => k.id) } }, select: { id: true, leg: true, parentId: true } });
  assert.deepEqual(
    after.sort((x, y) => x.id.localeCompare(y.id)),
    kids.sort((x, y) => x.id.localeCompare(y.id))
  );
  for (const url of ['/api/team/place', '/api/team/move', '/api/admin/place']) {
    assert.ok([403, 404].includes((await again.c.call('POST', url, { userId: a.id, leg: 'RIGHT' })).status));
  }
});

test('LEADERSHIP BONUS: points come from the new members my direct referrals sponsor; 6 points pays target 1', async () => {
  const g = await paidMember('RWCROOT', 'LEFT', 'ld_g');
  const gBefore = await balance(g.c);
  const d1 = await signup(g.left, 'LEFT', 'ld_d1'); // g's direct referral
  const d1Row = await rowOf(d1.email);

  // g's direct referral joining gives g NO point (points come from what d1 sponsors)
  assert.equal((await rowOf('ld_g@test.com')).leadershipPoints, 0);

  for (let i = 1; i <= 5; i++) await signup(i % 2 ? d1Row.leftCode! : d1Row.rightCode!, 'LEFT', `ld_m${i}`);
  let b = await bonusesOf(g.c);
  assert.equal(b.leadership.points, 5);
  assert.equal(b.leadership.completed, 0);
  assert.equal(await balance(g.c), gBefore, 'one point short');

  await signup(d1Row.leftCode!, 'LEFT', 'ld_m6');
  b = await bonusesOf(g.c);
  assert.equal(b.leadership.points, 6);
  assert.equal(b.leadership.completed, 1);
  assert.equal(b.leadership.current.target, 2);
  assert.equal(b.leadership.current.threshold, 18);
  assert.equal(await balance(g.c), gBefore + 600);
  assert.equal(b.history.find((h: any) => h.kind === 'LEADERSHIP').amount, '600.00');

  // deeper levels do not count: d1's members sponsoring more members gives g nothing
  const m1 = await rowOf('ld_m1@test.com');
  await signup(m1.leftCode!, 'LEFT', 'ld_deep');
  assert.equal((await rowOf('ld_g@test.com')).leadershipPoints, 6);
});

test('LEADERSHIP BONUS (brief example): 8 points = target 1 done; 16 more members = the 12-point target done too', async () => {
  const g = await paidMember('RWCROOT', 'LEFT', 'lb_g');
  const gRow = await rowOf('lb_g@test.com');
  const directs: Awaited<ReturnType<typeof rowOf>>[] = [];
  for (const n of ['lb_a', 'lb_b']) {
    const d = await signup(gRow.leftCode!, 'LEFT', n);
    directs.push(await rowOf(d.email));
  }
  // both directs sponsor 4 each = 8 points
  for (const d of directs) for (let i = 0; i < 4; i++) await signup(i % 2 ? d.leftCode! : d.rightCode!, 'LEFT', `${d.name}_x${i}`);
  let b = await bonusesOf(g.c);
  assert.deepEqual([b.leadership.points, b.leadership.completed], [8, 1]);

  // 4 more directs with 2 each = 8, the first two directs sponsor 4 each again = 8  => 24 points
  for (const n of ['lb_c', 'lb_d', 'lb_e', 'lb_f']) {
    const d = await rowOf((await signup(gRow.leftCode!, 'LEFT', n)).email);
    for (let i = 0; i < 2; i++) await signup(i ? d.leftCode! : d.rightCode!, 'LEFT', `${n}_x${i}`);
  }
  for (const d of directs) for (let i = 4; i < 8; i++) await signup(i % 2 ? d.leftCode! : d.rightCode!, 'LEFT', `${d.name}_x${i}`);
  b = await bonusesOf(g.c);
  assert.equal(b.leadership.points, 24);
  assert.equal(b.leadership.completed, 2, 'targets 6 and 12 are both complete, the third (42) is not');
  assert.equal(b.leadership.current.threshold, 42);
  const paid = (await g.c.call('GET', '/api/wallet')).json.data.earningsByType.LEADERSHIP_TARGET_BONUS;
  assert.equal(rupees(paid), 600 + 1200);
});

// ---------------------------------------------------------------- DASHBOARD, LEADERBOARD, TRAINING

test('DASHBOARD: totals, charts and the income breakdown all agree with the ledger and the wallet', async () => {
  const top = await paidMember('RWCROOT', 'LEFT', 'db_top');
  await signup(top.left, 'LEFT', 'db_l1');
  await signup(top.right, 'LEFT', 'db_r1');
  await signup(top.left, 'LEFT', 'db_l2');
  await signup(top.right, 'LEFT', 'db_r2'); // completes 2:2 => Rs 750
  const buyer = await signup(top.left, 'LEFT', 'db_buyer');
  await buy(buyer.c, 'ELITE'); // direct + passive income for db_top

  const r = await top.c.call('GET', '/api/dashboard/summary');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  const bal = await balance(top.c);

  assert.equal(d.profile.package, 'PRO');
  assert.match(d.profile.leftCode, /^RWCL/);
  assert.equal(d.stats.total, bal, 'total income equals the wallet (nothing was withdrawn)');
  assert.equal(d.stats.wallet, bal);
  assert.equal(rupees(d.breakdown.reduce((s: number, b: any) => s + b.amount, 0)), d.stats.total, 'breakdown adds up to the total');
  assert.ok(d.breakdown.some((b: any) => b.type === 'TEAM_PERFORMANCE_BONUS' && b.amount === 750));
  assert.ok(d.breakdown.every((b: any) => b.type !== 'COMPANY_FUND' && b.amount > 0));
  assert.deepEqual(d.breakdown.map((b: any) => b.amount), [...d.breakdown.map((b: any) => b.amount)].sort((a: number, b: number) => b - a));

  // everything was earned just now: today = 7 days = 30 days = total
  assert.equal(d.stats.today, d.stats.total);
  assert.equal(d.stats.last7, d.stats.total);
  assert.equal(d.stats.last30, d.stats.total);
  const sumOf = (rows: any[]) => rupees(rows.reduce((s, x) => s + x.amount, 0));
  assert.equal(sumOf(d.chart.today), d.stats.today);
  assert.equal(sumOf(d.chart.week), d.stats.last7);
  assert.equal(sumOf(d.chart.month), d.stats.last30);
  assert.deepEqual([d.chart.today.length, d.chart.week.length, d.chart.month.length], [8, 7, 6]);
  assert.equal(d.stats.team, 5, 'all five members hang under db_top in the binary tree');
  assert.ok(d.stats.passive >= 0);
});

test('AVATAR: a member can pick a preset, it shows on /me and the dashboard, and anything else is refused', async () => {
  const m = await signup('RWCROOT', 'LEFT', 'av_one');
  assert.equal((await m.c.call('GET', '/api/auth/me')).json.data.user.avatar, null);

  const ok = await m.c.call('PUT', '/api/dashboard/avatar', { avatar: 'a7' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await m.c.call('GET', '/api/auth/me')).json.data.user.avatar, 'a7');
  assert.equal((await m.c.call('GET', '/api/dashboard/summary')).json.data.profile.avatar, 'a7');

  for (const bad of ['a13', 'a0', '../x', '<img>', 7, undefined]) {
    const r = await m.c.call('PUT', '/api/dashboard/avatar', { avatar: bad });
    assert.equal(r.status, 400, `rejects ${String(bad)}`);
  }
  assert.equal((await m.c.call('GET', '/api/auth/me')).json.data.user.avatar, 'a7', 'bad requests change nothing');

  assert.equal((await m.c.call('PUT', '/api/dashboard/avatar', { avatar: null })).status, 200);
  assert.equal((await m.c.call('GET', '/api/auth/me')).json.data.user.avatar, null);
  const anon = await new Client().call('PUT', '/api/dashboard/avatar', { avatar: 'a1' });
  assert.equal(anon.status, 401);
});

test('DASHBOARD: older income lands in the 30-day figures but not in today or the last 7 days', async () => {
  const m = await signup('RWCROOT', 'RIGHT', 'db_old');
  const row = await rowOf('db_old@test.com');
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  await prisma.ledgerEntry.createMany({
    data: [
      { userId: row.id, type: 'DEMAT_DIRECT', amount: 100, createdAt: daysAgo(3) },
      { userId: row.id, type: 'DEMAT_DIRECT', amount: 1000, createdAt: daysAgo(20) },
      { userId: row.id, type: 'DEMAT_DIRECT', amount: 10000, createdAt: daysAgo(60) } // outside 30 days
    ]
  });
  await prisma.user.update({ where: { id: row.id }, data: { walletBalance: 11100 } }); // keep wallet = ledger
  const d = (await m.c.call('GET', '/api/dashboard/summary')).json.data;
  assert.equal(d.stats.today, 0);
  assert.equal(d.stats.last7, 100);
  assert.equal(d.stats.last30, 1100);
  assert.equal(d.stats.total, 11100);
  assert.equal(d.chart.month.reduce((s: number, x: any) => s + x.amount, 0), 1100);
});

test('DASHBOARD: only signed-in members can see it', async () => {
  assert.equal((await new Client().call('GET', '/api/dashboard/summary')).status, 401);
  assert.equal((await new Client().call('GET', '/api/dashboard/leaderboard')).status, 401);
  assert.equal((await new Client().call('GET', '/api/site/training')).status, 401);
});

test('LEADERBOARD: top 10 by income earned, short names only, and the caller always sees their own position', async () => {
  const star = await signup('RWCROOT', 'LEFT', 'lbstar');
  const row = await rowOf('lbstar@test.com');
  await prisma.user.update({ where: { id: row.id }, data: { name: 'Priya Kumari Sharma', avatar: 'a3' } });
  // give 12 members known earnings so a caller outside the top 10 exists
  const names = Array.from({ length: 12 }, (_, i) => `lbm${i}`);
  const members = [];
  for (const n of names) members.push(await signup('RWCROOT', 'LEFT', n));
  for (let i = 0; i < members.length; i++) {
    const u = await rowOf(`${names[i]}@test.com`);
    await prisma.ledgerEntry.create({ data: { userId: u.id, type: 'DIRECT_INCOME', amount: 1_000_000 - i * 1000 } });
    await prisma.ledgerEntry.create({ data: { userId: u.id, type: 'COMPANY_FUND', amount: 9_999_999 } }); // never counts
    await prisma.ledgerEntry.create({ data: { userId: u.id, type: 'DIRECT_INCOME', amount: -5 } }); // debits never count
    await prisma.user.update({ where: { id: u.id }, data: { walletBalance: 1_000_000 - i * 1000 - 5 + 9_999_999 } });
  }

  const r = await members[11].c.call('GET', '/api/dashboard/leaderboard');
  assert.equal(r.status, 200);
  const items = r.json.data.items as any[];
  assert.equal(items.length, 10, 'only the top 10 are listed');
  const totals = items.map((i) => i.total);
  assert.deepEqual(totals, [...totals].sort((a, b) => b - a), 'sorted by income, high to low');
  assert.deepEqual(items.map((i) => i.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(items[0].total, 1_000_000, 'company fund and debits are not counted');
  assert.ok(items.every((i) => !i.me), 'the 12th member is not in the top 10');
  const me = r.json.data.me;
  assert.equal(me.position, 12);
  assert.equal(me.total, 1_000_000 - 11 * 1000);
  assert.equal(me.me, true);

  // a member inside the top 10 is flagged in the list and still gets `me`
  const first = await members[0].c.call('GET', '/api/dashboard/leaderboard');
  assert.equal(first.json.data.items[0].me, true);
  assert.equal(first.json.data.me.position, 1);

  // someone who has earned nothing is not ranked
  const zero = (await star.c.call('GET', '/api/dashboard/leaderboard')).json.data;
  assert.equal(zero.me.position, 0);
  assert.equal(zero.me.total, 0);
  assert.equal(zero.me.name, 'Priya S.');
  assert.equal(zero.me.avatar, 'a3');

  for (const it of [...items, zero.me]) assert.deepEqual(Object.keys(it).sort(), ['avatar', 'me', 'name', 'package', 'position', 'rank', 'total']);
  assert.ok(!JSON.stringify(r.json).includes('@'), 'no email addresses');
});

test('TREE: shows the binary tree a few levels at a time, with counts per side, and only your own branches', async () => {
  const top = await paidMember('RWCROOT', 'LEFT', 'tt_top');
  const a = await signup(top.left, 'LEFT', 'tt_a'); // top.left
  await signup(top.right, 'LEFT', 'tt_b'); // top.right
  let parentCode = (await rowOf(a.email)).leftCode!;
  const chain = [] as string[];
  for (const n of ['tt_a1', 'tt_a2', 'tt_a3']) {
    const m = await signup(parentCode, 'LEFT', n);
    chain.push(m.email);
    parentCode = (await rowOf(m.email)).leftCode!;
  }
  // tt_a -> tt_a1 -> tt_a2 -> tt_a3 all down the left; top is depth 0, so tt_a3 is at depth 4

  const r = await top.c.call('GET', '/api/team/tree');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.equal(d.isMe, true);
  assert.deepEqual(d.counts, { left: 4, right: 1, total: 5 });
  assert.equal(d.tree.name, 'You');
  assert.ok(d.tree.left && d.tree.right);
  assert.equal(d.tree.right.left, null);
  assert.equal(d.tree.right.right, null);
  assert.equal(d.tree.right.more, false);
  const a2 = d.tree.left.left.left; // depth 3 = the last drawn row
  assert.ok(a2, 'three levels below the top are drawn');
  assert.equal(a2.left, null, 'the fourth level is not drawn');
  assert.equal(a2.more, true, 'but the member is marked as having more below');
  assert.equal(d.tree.left.more, false);
  for (const node of [d.tree, d.tree.left, a2]) {
    assert.deepEqual(Object.keys(node).sort(), ['avatar', 'id', 'joinedAt', 'left', 'more', 'name', 'package', 'rank', 'right']);
  }
  assert.ok(!JSON.stringify(d).includes('@'), 'no email addresses');

  // walk into a branch: re-centred on that member, counts stay yours
  const branch = await top.c.call('GET', `/api/team/tree?root=${a2.id}`);
  assert.equal(branch.status, 200);
  assert.equal(branch.json.data.isMe, false);
  assert.equal(branch.json.data.tree.id, a2.id);
  assert.ok(branch.json.data.tree.left, 'the hidden member is now drawn');
  assert.deepEqual(branch.json.data.counts, d.counts);

  // other members cannot read your branches; junk ids are refused
  const stranger = await signup('RWCROOT', 'RIGHT', 'tt_stranger');
  assert.equal((await stranger.c.call('GET', `/api/team/tree?root=${a2.id}`)).status, 404);
  assert.equal((await stranger.c.call('GET', `/api/team/tree?root=${top.id}`)).status, 404);
  assert.equal((await top.c.call('GET', '/api/team/tree?root=not-an-id')).status, 400);
  assert.equal((await new Client().call('GET', '/api/team/tree')).status, 401);

  // passive income levels follow the package: PRO opens 1-7, ELITE 1-12
  const pro = (await top.c.call('GET', '/api/team/summary')).json.data;
  assert.equal(pro.passiveLevels.length, 12);
  assert.deepEqual(pro.passiveLevels.map((l: any) => l.unlocked), [...Array(7).fill(true), ...Array(5).fill(false)]);
  assert.equal(pro.passiveLevels[0].pct, 5);
  await buy(top.c, 'ELITE');
  const elite = (await top.c.call('GET', '/api/team/summary')).json.data;
  assert.ok(elite.passiveLevels.every((l: any) => l.unlocked));
});

test('TRAINING: members read lessons, only admins write them, and only https links are accepted', async () => {
  const m = await signup('RWCROOT', 'LEFT', 'tr_reader');
  const lesson = { title: 'Welcome to RWC', description: 'Start here', url: 'https://example.com/welcome' };

  assert.equal((await m.c.call('PUT', '/api/site/content/training', { items: [lesson] })).status, 403);
  assert.equal((await admin.call('PUT', '/api/site/content/training', { items: [{ ...lesson, url: 'http://example.com/x' }] })).status, 400);
  assert.equal((await admin.call('PUT', '/api/site/content/training', { items: [{ ...lesson, url: 'javascript:alert(1)' }] })).status, 400);
  assert.equal((await admin.call('PUT', '/api/site/content/training', { items: [{ ...lesson, url: '' }] })).status, 400);
  assert.equal((await admin.call('PUT', '/api/site/content/training', { items: [{ ...lesson, title: '' }] })).status, 400);

  assert.equal((await admin.call('PUT', '/api/site/content/training', { items: [lesson] })).status, 200);
  const got = await m.c.call('GET', '/api/site/training');
  assert.equal(got.status, 200);
  assert.deepEqual(got.json.data.items, [{ ...lesson, tier: 'TRAINEE', unlocked: true }]);

  // package tiers: the link of a locked lesson never reaches the member; upgrading unlocks it; admins see everything
  const pro = { title: 'Pro lesson', description: '', url: 'https://example.com/pro-secret', tier: 'PRO' };
  const elite = { title: 'Elite lesson', description: '', url: 'https://example.com/elite-secret', tier: 'ELITE' };
  assert.equal((await admin.call('PUT', '/api/site/content/training', { items: [lesson, pro, elite] })).status, 200);
  assert.equal((await admin.call('PUT', '/api/site/content/training', { items: [{ ...lesson, tier: 'GOLD' }] })).status, 400);
  const asTrainee = await m.c.call('GET', '/api/site/training');
  assert.deepEqual(asTrainee.json.data.items.map((i: any) => [i.title, i.tier, i.unlocked]), [['Welcome to RWC', 'TRAINEE', true], ['Pro lesson', 'PRO', false], ['Elite lesson', 'ELITE', false]]);
  assert.equal(JSON.stringify(asTrainee.json).includes('secret'), false, 'locked links are not sent');
  await buy(m.c, 'PRO');
  const asPro = (await m.c.call('GET', '/api/site/training')).json.data.items;
  assert.deepEqual(asPro.map((i: any) => i.unlocked), [true, true, false]);
  assert.equal(asPro[1].url, pro.url);
  assert.equal(JSON.stringify(asPro).includes('elite-secret'), false);
  await buy(m.c, 'ELITE');
  assert.deepEqual((await m.c.call('GET', '/api/site/training')).json.data.items.map((i: any) => i.unlocked), [true, true, true]);
  assert.deepEqual((await admin.call('GET', '/api/site/training')).json.data.items.map((i: any) => i.unlocked), [true, true, true]);
  assert.equal(JSON.stringify((await admin.call('GET', '/api/site/training')).json).includes('elite-secret'), true);
  assert.equal((await admin.call('PUT', '/api/site/content/training', { items: [lesson] })).status, 200); // leave it as it was

  // not part of the public home page content
  const pub = await new Client().call('GET', '/api/site/content');
  assert.equal(JSON.stringify(pub.json).includes('Welcome to RWC'), false);
});

test('WALLET: transactions can be filtered by income type, and a bogus type is ignored', async () => {
  const c = new Client();
  assert.equal((await c.call('POST', '/api/auth/login', { email: 'db_top@test.com', password: 'Password123' })).status, 200);
  const all = (await c.call('GET', '/api/wallet/transactions')).json.data;
  const only = (await c.call('GET', '/api/wallet/transactions?type=TEAM_PERFORMANCE_BONUS')).json.data;
  assert.ok(only.total === 1 && only.total < all.total);
  assert.ok(only.items.every((e: any) => e.type === 'TEAM_PERFORMANCE_BONUS'));
  const bogus = (await c.call('GET', '/api/wallet/transactions?type=x%27%20OR%201=1')).json.data;
  assert.equal(bogus.total, all.total);
});

// ---------------------------------------------------------------- INTEGRITY

// ---------------------------------------------------------------- WALLETS, ACTIVATION, WITHDRAWALS, CAMPAIGNS

const TXN = 'TxnPass#2026';
const FUND_PROOF = { fileName: 'pay.png', fileData: '' }; // filled in below, once REPORT_PNG exists
const REPORT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
FUND_PROOF.fileData = REPORT_PNG;
const setTxn = (c: Client, extra: object = { loginPassword: 'Password123' }) => c.call('POST', '/api/wallet/txn-password', { newPassword: TXN, ...extra });
const walletOf = async (c: Client) => (await c.call('GET', '/api/wallet')).json.data;
const actOf = async (c: Client) => (await c.call('GET', '/api/wallet/activation')).json.data;
async function addFund(c: Client, amount: number, ref = 'UTR123456') {
  const r = await c.call('POST', '/api/wallet/fund', { ...FUND_PROOF, amount, reference: ref });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const list = (await admin.call('GET', '/api/admin/fund-requests')).json.data.items as any[];
  const mine = list.find((x) => x.reference === ref && x.status === 'PENDING');
  assert.ok(mine, 'the request shows up for the admin');
  const ok = await admin.call('POST', `/api/admin/fund-requests/${mine.id}/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  return mine.id as string;
}

test('TXN PASSWORD: needed before money moves, set only with the login password, and locks after 5 wrong guesses', async () => {
  const m = await signup('RWCROOT', 'LEFT', 'mny_tp_one');
  assert.equal((await m.c.call('POST', '/api/wallet/transfer', { amount: 10, txnPassword: 'x' })).status, 400, 'no transaction password yet');
  assert.equal((await setTxn(m.c, { loginPassword: 'WrongPass1' })).status, 401);
  assert.equal((await setTxn(m.c, {})).status, 401, 'login password is required');
  assert.equal((await m.c.call('POST', '/api/wallet/txn-password', { newPassword: 'short', loginPassword: 'Password123' })).status, 400);
  assert.equal((await setTxn(m.c)).status, 200);
  assert.equal((await walletOf(m.c)).hasTxnPassword, true);

  // 5 wrong guesses lock it, even the right password is refused during the lock
  for (let i = 0; i < 4; i++) assert.equal((await m.c.call('POST', '/api/wallet/transfer', { amount: 10, txnPassword: 'nope' + i })).status, 401);
  assert.equal((await m.c.call('POST', '/api/wallet/transfer', { amount: 10, txnPassword: 'nope5' })).status, 429);
  assert.equal((await m.c.call('POST', '/api/wallet/transfer', { amount: 10, txnPassword: TXN })).status, 429, 'locked');
});

test('ADD FUND: an admin approves a payment reference and it lands in the activation wallet, once', async () => {
  const m = await signup('RWCROOT', 'LEFT', 'mny_af_one');
  assert.equal((await m.c.call('POST', '/api/wallet/fund', { ...FUND_PROOF, amount: -5, reference: 'UTR1234' })).status, 400);
  assert.equal((await m.c.call('POST', '/api/wallet/fund', { ...FUND_PROOF, amount: 100, reference: 'ab' })).status, 400);
  assert.equal((await m.c.call('POST', '/api/wallet/fund', { ...FUND_PROOF, amount: 10.123, reference: 'UTR1234' })).status, 400, 'at most 2 decimals');

  const id = await addFund(m.c, 5000, 'UTR-AF-1');
  assert.equal((await actOf(m.c)).activation, 5000);
  assert.equal((await admin.call('POST', `/api/admin/fund-requests/${id}/approve`)).status, 409, 'cannot be approved twice');
  assert.equal((await actOf(m.c)).activation, 5000);

  assert.equal((await m.c.call('POST', '/api/wallet/fund', { ...FUND_PROOF, amount: 700, reference: 'UTR-AF-2' })).status, 201);
  const pending = ((await admin.call('GET', '/api/admin/fund-requests')).json.data.items as any[]).find((x) => x.reference === 'UTR-AF-2');
  assert.equal((await admin.call('POST', `/api/admin/fund-requests/${pending.id}/reject`, { note: 'no such payment' })).status, 200);
  assert.equal((await actOf(m.c)).activation, 5000, 'a rejected request adds nothing');
  const mine = (await m.c.call('GET', '/api/wallet/fund')).json.data.items as any[];
  assert.deepEqual(mine.map((x) => x.status).sort(), ['APPROVED', 'REJECTED']);
  assert.equal((await m.c.call('POST', '/api/admin/fund-requests/x/approve')).status, 403, 'members cannot approve');
});

test('ACTIVATION: paying from the activation wallet upgrades yourself or your team, and runs the income plan', async () => {
  const prices = (await new Client().call('GET', '/api/packages/prices')).json.data as { PRO: number; ELITE: number };
  const top = await paidMember('RWCROOT', 'LEFT', 'mny_ac_top'); // PRO, sponsor of the others
  const mate = await signup(top.left, 'LEFT', 'mny_ac_mate'); // in top's team, TRAINEE
  const outsider = await signup('RWCROOT', 'RIGHT', 'mny_ac_out');
  const mateRow = await rowOf(mate.email);
  const outRow = await rowOf(outsider.email);
  await setTxn(top.c);
  await addFund(top.c, prices.PRO + prices.ELITE + 500, 'UTR-AC-1');
  const before = (await walletOf(top.c)).totalEarned;

  const ask = (body: object) => top.c.call('POST', '/api/wallet/activate', { txnPassword: TXN, ...body });
  assert.equal((await ask({ affiliateId: mateRow.referralCode, package: 'PRO', txnPassword: 'wrong' })).status, 401);
  assert.equal((await ask({ affiliateId: outRow.referralCode, package: 'PRO' })).status, 403, 'not in your team');
  assert.equal((await ask({ affiliateId: 'RWCNOSUCH', package: 'PRO' })).status, 404);
  assert.equal((await ask({ affiliateId: (await rowOf(top.email)).referralCode, package: 'PRO' })).status, 409, 'already PRO');

  const r = await ask({ affiliateId: mateRow.referralCode.toLowerCase(), package: 'PRO' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal((await rowOf(mate.email)).package, 'PRO');
  assert.equal((await actOf(top.c)).activation, prices.ELITE + 500);
  assert.ok((await walletOf(top.c)).totalEarned > before, 'the sponsor earned direct income from the sale');
  assert.equal((await ask({ affiliateId: mateRow.referralCode, package: 'PRO' })).status, 409, 'cannot buy the same package twice');

  // own ID: PRO -> ELITE
  assert.equal((await ask({ affiliateId: (await rowOf(top.email)).referralCode, package: 'ELITE' })).status, 201);
  assert.equal((await rowOf(top.email)).package, 'ELITE');
  const left = (await actOf(top.c)).activation;
  assert.equal(left, 500);
  // not enough money left
  assert.equal((await ask({ affiliateId: (await rowOf(outsider.email)).referralCode, package: 'PRO' })).status, 403);
  const hist = (await actOf(top.c)).entries as any[];
  assert.equal(hist.filter((e) => e.kind === 'SPEND').length, 2);
  assert.equal(hist.filter((e) => e.kind === 'FUND_ADDED').length, 1);
  // purchases are recorded and confirmed
  const purchases = await prisma.packagePurchase.findMany({ where: { reference: 'ACTIVATION_WALLET' } });
  assert.ok(purchases.length >= 2 && purchases.every((p) => p.status === 'CONFIRMED'));
});

test('ACTIVATION: concurrent upgrades cannot spend the same money twice', async () => {
  const prices = (await new Client().call('GET', '/api/packages/prices')).json.data as { PRO: number; ELITE: number };
  const top = await paidMember('RWCROOT', 'RIGHT', 'mny_cc_top');
  const a = await signup(top.left, 'LEFT', 'mny_cc_a');
  const b = await signup(top.right, 'LEFT', 'mny_cc_b');
  await setTxn(top.c);
  await addFund(top.c, prices.PRO + 10, 'UTR-CC-1'); // enough for exactly one
  const codes = [(await rowOf(a.email)).referralCode, (await rowOf(b.email)).referralCode];
  const res = await Promise.all(codes.map((affiliateId) => top.c.call('POST', '/api/wallet/activate', { affiliateId, package: 'PRO', txnPassword: TXN })));
  assert.deepEqual(res.map((r) => r.status).sort(), [201, 400]);
  assert.equal((await actOf(top.c)).activation, 10);
});

test('TRANSFER: wallet money moves to the activation wallet and the ledger stays balanced', async () => {
  const top = await paidMember('RWCROOT', 'LEFT', 'mny_tr_top');
  const buyer = await signup(top.left, 'LEFT', 'mny_tr_buyer');
  await buy(buyer.c, 'PRO'); // direct income for tr_top
  await setTxn(top.c);
  const w = await walletOf(top.c);
  assert.ok(w.available > 100);
  assert.equal((await top.c.call('POST', '/api/wallet/transfer', { amount: w.available + 1, txnPassword: TXN })).status, 400, 'more than available');
  assert.equal((await top.c.call('POST', '/api/wallet/transfer', { amount: 100, txnPassword: 'bad' })).status, 401);
  assert.equal((await top.c.call('POST', '/api/wallet/transfer', { amount: 100, txnPassword: TXN })).status, 200);
  const after = await walletOf(top.c);
  assert.equal(Number(after.balance), Number(w.balance) - 100);
  assert.equal(after.activationBalance, 100);
  assert.equal(after.totalEarned, w.totalEarned, 'moving money is not income');
  const ledger = (await top.c.call('GET', '/api/wallet/transactions')).json.data.items as any[];
  assert.ok(ledger.some((e) => e.type === 'WALLET_TRANSFER' && Number(e.amount) === -100));
});

test('WITHDRAWAL: needs bank details, reserves the amount, and the wallet is debited only on approval', async () => {
  const top = await paidMember('RWCROOT', 'LEFT', 'mny_wd_top');
  const buyer = await signup(top.left, 'LEFT', 'mny_wd_buyer');
  await buy(buyer.c, 'PRO');
  await setTxn(top.c);
  const w = await walletOf(top.c);
  assert.ok(w.available >= 500);
  const ask = (amount: number, txnPassword = TXN) => top.c.call('POST', '/api/wallet/withdraw', { amount, txnPassword });

  assert.equal((await ask(200)).status, 400, 'bank details first');
  const bank = { bankName: 'State Bank', accountNumber: '123456789012', ifsc: 'SBIN0001234', upiId: 'wd.top@upi' };
  assert.equal((await top.c.call('PUT', '/api/wallet/bank', { ...bank, ifsc: 'BAD', txnPassword: TXN })).status, 400);
  assert.equal((await top.c.call('PUT', '/api/wallet/bank', { ...bank, accountNumber: '12ab', txnPassword: TXN })).status, 400);
  assert.equal((await top.c.call('PUT', '/api/wallet/bank', { ...bank, txnPassword: 'wrong' })).status, 401);
  assert.equal((await top.c.call('PUT', '/api/wallet/bank', { ...bank, ifsc: 'sbin0001234', txnPassword: TXN })).status, 200);

  const masked = (await top.c.call('GET', '/api/wallet/bank')).json;
  assert.equal(masked.data.bank.account.endsWith('9012'), true);
  assert.equal(JSON.stringify(masked).includes('123456789012'), false, 'the account number is never sent unmasked');
  assert.equal((await top.c.call('POST', '/api/wallet/bank/unlock', { txnPassword: 'wrong' })).status, 401);
  assert.equal((await top.c.call('POST', '/api/wallet/bank/unlock', { txnPassword: TXN })).json.data.bank.account, '123456789012');
  const stored = await prisma.bankDetails.findUniqueOrThrow({ where: { userId: (await rowOf(top.email)).id } });
  assert.equal(stored.accountEnc.includes('123456789012'), false, 'stored encrypted');

  assert.equal((await ask(50)).status, 400, 'below the minimum');
  assert.equal((await ask(w.available + 1)).status, 400, 'more than available');
  assert.equal((await ask(200, 'wrong')).status, 401);
  assert.equal((await ask(200)).status, 201);
  const mid = await walletOf(top.c);
  assert.equal(Number(mid.balance), Number(w.balance), 'nothing leaves the wallet until approval');
  assert.equal(mid.pendingWithdrawals, 200);
  assert.equal(mid.available, w.available - 200, 'but it is reserved');
  assert.equal((await ask(mid.available + 1)).status, 400, 'the reserved part cannot be requested again');

  const listed = ((await admin.call('GET', '/api/admin/withdrawals')).json.data.items as any[]).find((x) => x.userId === (stored.userId));
  assert.equal(listed.bank.account, '123456789012', 'the admin sees where to pay');
  assert.equal(listed.user.email, top.email, 'the admin sees who is asking');
  assert.equal(listed.hasProof, false);
  const paid = { reference: 'UTR-PAYOUT-1', fileName: 'paid.png', fileData: REPORT_PNG };
  assert.equal((await top.c.call('POST', `/api/admin/withdrawals/${listed.id}/approve`, paid)).status, 403);
  assert.equal((await admin.call('POST', `/api/admin/withdrawals/${listed.id}/approve`)).status, 400, 'paying needs the transaction ID and a screenshot');
  assert.equal((await admin.call('POST', `/api/admin/withdrawals/${listed.id}/approve`, { reference: 'UTR-PAYOUT-1', fileName: 'x', fileData: Buffer.from('<html>no</html>').toString('base64') })).status, 400, 'the screenshot must be a real image');
  assert.equal((await admin.call('POST', `/api/admin/withdrawals/${listed.id}/approve`, { reference: 'abc', fileName: 'x.png', fileData: REPORT_PNG })).status, 400, 'transaction ID too short');
  assert.equal((await admin.call('POST', `/api/admin/withdrawals/${listed.id}/approve`, paid)).status, 200);
  assert.equal((await admin.call('POST', `/api/admin/withdrawals/${listed.id}/approve`, { ...paid, reference: 'UTR-PAYOUT-2' })).status, 409, 'once only');

  // the proof is recorded and visible to the admin and to the member, nobody else
  const paidRow = ((await admin.call('GET', '/api/admin/withdrawals?status=APPROVED')).json.data.items as any[]).find((x) => x.id === listed.id);
  assert.deepEqual([paidRow.payoutRef, paidRow.hasProof], ['UTR-PAYOUT-1', true]);
  assert.equal(JSON.stringify(paidRow).includes('fileData'), false, 'the admin list never carries the picture');
  assert.equal((await admin.call('GET', `/api/admin/withdrawals/${listed.id}/proof`)).json.data.mime, 'image/png');
  assert.equal((await top.c.call('GET', `/api/admin/withdrawals/${listed.id}/proof`)).status, 403);
  const mineAfter = ((await top.c.call('GET', '/api/wallet/withdrawals')).json.data.items as any[]).find((x) => x.id === listed.id);
  assert.deepEqual([mineAfter.transactionId, mineAfter.hasProof], ['UTR-PAYOUT-1', true]);
  assert.equal((await top.c.call('GET', `/api/wallet/withdrawals/${listed.id}/proof`)).json.data.mime, 'image/png');
  const stranger = await signup('RWCROOT', 'RIGHT', 'mny_wd_stranger');
  assert.equal((await stranger.c.call('GET', `/api/wallet/withdrawals/${listed.id}/proof`)).status, 404, 'not someone else\'s payout');
  const done = await walletOf(top.c);
  assert.equal(Number(done.balance), Number(w.balance) - 200);
  assert.equal(done.totalPaid, 200);
  assert.equal(done.pendingWithdrawals, 0);
  assert.equal(done.totalEarned, w.totalEarned, 'withdrawing is not negative income');

  // one bank transaction ID cannot be used to mark two withdrawals paid
  assert.equal((await ask(150)).status, 201);
  const next = ((await admin.call('GET', '/api/admin/withdrawals')).json.data.items as any[]).find((x) => x.userId === stored.userId);
  assert.equal((await admin.call('POST', `/api/admin/withdrawals/${next.id}/approve`, { ...paid, reference: 'utr-payout-1' })).status, 409);
  assert.equal((await admin.call('POST', `/api/admin/withdrawals/${next.id}/reject`)).status, 200);

  // the admin page can list everything at once and search by member
  const everyone = (await admin.call('GET', '/api/admin/withdrawals?status=ALL')).json.data.items as any[];
  assert.ok(everyone.length >= 2 && new Set(everyone.map((x) => x.status)).size >= 2, 'ALL mixes the statuses');
  const byName = (await admin.call('GET', `/api/admin/withdrawals?status=ALL&q=${encodeURIComponent(top.email.split('@')[0])}`)).json.data.items as any[];
  assert.ok(byName.length >= 1 && byName.every((x) => x.user.email === top.email), 'search finds only that member');
  assert.equal(((await admin.call('GET', '/api/admin/withdrawals?status=ALL&q=zzz-no-such-member')).json.data.items as any[]).length, 0);

  // a rejected request frees the reservation
  assert.equal((await ask(300)).status, 201);
  const second = ((await admin.call('GET', '/api/admin/withdrawals')).json.data.items as any[]).find((x) => x.userId === stored.userId);
  assert.equal((await admin.call('POST', `/api/admin/withdrawals/${second.id}/reject`, { note: 'wrong account' })).status, 200);
  const freed = await walletOf(top.c);
  assert.equal(freed.pendingWithdrawals, 0);
  assert.equal(Number(freed.balance), Number(w.balance) - 200);
  assert.deepEqual(((await top.c.call('GET', '/api/wallet/withdrawals')).json.data.items as any[]).map((x) => x.status).sort(), ['APPROVED', 'REJECTED', 'REJECTED']);
});

test('CAMPAIGNS: members send proof reports, admins approve, and the reward is paid to the wallet once', async () => {
  const m = await signup('RWCROOT', 'RIGHT', 'mny_cp_one');
  const other = await signup('RWCROOT', 'RIGHT', 'mny_cp_two');
  const camp = { title: 'Demat opening', description: 'Open a demat account', reward: 300, url: 'https://example.com/open', videoUrl: '', needsProof: true, isActive: true };

  assert.equal((await m.c.call('POST', '/api/admin/campaigns', camp)).status, 403, 'members cannot create campaigns');
  assert.equal((await admin.call('POST', '/api/admin/campaigns', { ...camp, url: 'http://example.com' })).status, 400);
  assert.equal((await admin.call('POST', '/api/admin/campaigns', { ...camp, reward: -1 })).status, 400);
  const created = await admin.call('POST', '/api/admin/campaigns', camp);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const cid = created.json.data.id as string;
  const noProof = await admin.call('POST', '/api/admin/campaigns', { ...camp, title: 'Instagram promo', needsProof: false, reward: 50 });
  const off = await admin.call('POST', '/api/admin/campaigns', { ...camp, title: 'Old one', isActive: false });

  const list = (await m.c.call('GET', '/api/campaigns')).json.data.items as any[];
  assert.ok(list.some((c) => c.id === cid) && list.some((c) => c.id === noProof.json.data.id));
  assert.ok(!list.some((c) => c.id === off.json.data.id), 'inactive campaigns are hidden');

  const body = { campaignId: cid, holderName: 'Ravi Kumar', mobile: '9876543210', fileName: 'proof.png', fileData: REPORT_PNG };
  assert.equal((await m.c.call('POST', '/api/campaigns/reports', { ...body, mobile: '12345' })).status, 400);
  assert.equal((await m.c.call('POST', '/api/campaigns/reports', { ...body, fileData: Buffer.from('<html>not an image</html>').toString('base64') })).status, 400, 'must really be an image');
  assert.equal((await m.c.call('POST', '/api/campaigns/reports', { ...body, fileData: 'A'.repeat(950_000) })).status, 413);
  assert.equal((await m.c.call('POST', '/api/campaigns/reports', { ...body, campaignId: noProof.json.data.id })).status, 404, 'no reports for a no-proof campaign');
  const sent = await m.c.call('POST', '/api/campaigns/reports', body);
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.equal((await other.c.call('POST', '/api/campaigns/reports', body)).status, 409, 'same mobile, same campaign');
  const rid = sent.json.data.id as string;

  // owner can edit and read it, others cannot
  assert.equal((await m.c.call('PUT', `/api/campaigns/reports/${rid}`, { holderName: 'Ravi K Sharma', mobile: '9876543210' })).status, 200);
  assert.equal((await other.c.call('PUT', `/api/campaigns/reports/${rid}`, { holderName: 'Hacker', mobile: '9876543211' })).status, 404);
  assert.equal((await other.c.call('GET', `/api/campaigns/reports/${rid}/file`)).status, 404);
  assert.equal((await m.c.call('GET', `/api/campaigns/reports/${rid}/file`)).json.data.mime, 'image/png');
  assert.equal((await admin.call('GET', `/api/campaigns/reports/${rid}/file`)).status, 200);
  const mine = (await m.c.call('GET', '/api/campaigns/reports')).json.data.items as any[];
  assert.equal(mine[0].holderName, 'Ravi K Sharma');
  assert.equal(JSON.stringify(mine).includes('fileData'), false);

  const w0 = Number((await walletOf(m.c)).balance);
  const pending = ((await admin.call('GET', '/api/admin/reports')).json.data.items as any[]).find((x) => x.id === rid);
  assert.equal(pending.user.name.length > 0, true);
  assert.equal((await m.c.call('POST', `/api/admin/reports/${rid}/approve`)).status, 403);
  assert.equal((await admin.call('POST', `/api/admin/reports/${rid}/approve`)).status, 200);
  assert.equal((await admin.call('POST', `/api/admin/reports/${rid}/approve`)).status, 409, 'rewarded once');
  assert.equal(Number((await walletOf(m.c)).balance), w0 + 300);
  const ledger = (await m.c.call('GET', '/api/wallet/transactions')).json.data.items as any[];
  assert.ok(ledger.some((e) => e.type === 'CAMPAIGN_REWARD' && Number(e.amount) === 300));
  assert.deepEqual((await m.c.call('GET', '/api/campaigns/stats')).json.data, { total: 1, approved: 1, earnings: 300 });

  // an approved report is a record: it cannot be edited or deleted
  assert.equal((await m.c.call('PUT', `/api/campaigns/reports/${rid}`, { holderName: 'Changed', mobile: '9876543210' })).status, 409);
  assert.equal((await m.c.call('DELETE', `/api/campaigns/reports/${rid}`)).status, 409);

  // rejected + deleted reports pay nothing; a campaign with reports is switched off, not deleted
  const second = await m.c.call('POST', '/api/campaigns/reports', { ...body, mobile: '9123456780' });
  assert.equal((await admin.call('POST', `/api/admin/reports/${second.json.data.id}/reject`, { note: 'blurry' })).status, 200);
  const third = await m.c.call('POST', '/api/campaigns/reports', { ...body, mobile: '9123456781' });
  assert.equal((await m.c.call('DELETE', `/api/campaigns/reports/${third.json.data.id}`)).status, 200);
  assert.equal(Number((await walletOf(m.c)).balance), w0 + 300);
  assert.equal((await admin.call('DELETE', `/api/admin/campaigns/${cid}`)).status, 200);
  assert.ok(!((await m.c.call('GET', '/api/campaigns')).json.data.items as any[]).some((c) => c.id === cid));
  assert.equal((await prisma.campaign.findUnique({ where: { id: cid } }))?.isActive, false);
});

test('PROFILE: a member edits name, mobile and city; a mobile number belongs to one account', async () => {
  const a = await signup('RWCROOT', 'LEFT', 'mny_pf_a');
  const b = await signup('RWCROOT', 'LEFT', 'mny_pf_b');
  assert.equal((await a.c.call('PUT', '/api/dashboard/profile', { name: 'A', phone: '', city: '' })).status, 400);
  assert.equal((await a.c.call('PUT', '/api/dashboard/profile', { name: 'Asha Rao', phone: '123', city: '' })).status, 400);
  assert.equal((await a.c.call('PUT', '/api/dashboard/profile', { name: 'Asha Rao', phone: '9898989898', city: 'Pune' })).status, 200);
  const me = (await a.c.call('GET', '/api/auth/me')).json.data.user;
  assert.deepEqual([me.name, me.phone, me.city], ['Asha Rao', '9898989898', 'Pune']);
  assert.equal((await b.c.call('PUT', '/api/dashboard/profile', { name: 'Bina Rao', phone: '9898989898', city: '' })).status, 409);
});

test('ADMIN: overview and member list are admin-only, and switching a member off signs them out at once', async () => {
  const m = await signup('RWCROOT', 'LEFT', 'mny_ad_one');
  const row = await rowOf(m.email);

  assert.equal((await m.c.call('GET', '/api/admin/overview')).status, 403);
  assert.equal((await m.c.call('GET', '/api/admin/members')).status, 403);
  assert.equal((await new Client().call('GET', '/api/admin/overview')).status, 401);

  const o = (await admin.call('GET', '/api/admin/overview')).json.data;
  assert.ok(o.members >= 1 && o.active >= 1);
  assert.deepEqual(Object.keys(o.waiting).sort(), ['funds', 'purchases', 'reports', 'withdrawals']);
  assert.equal(typeof o.withdrawalsPendingAmount, 'number');
  assert.equal(typeof o.withdrawalsPaidAmount, 'number');

  const found = (await admin.call('GET', `/api/admin/members?q=${encodeURIComponent('mny_ad_one')}`)).json.data;
  assert.equal(found.total, 1);
  assert.equal(found.items[0].email, m.email);
  const byCode = (await admin.call('GET', `/api/admin/members?q=${row.referralCode.toLowerCase()}`)).json.data;
  assert.equal(byCode.items[0]?.email, m.email, 'search by Affiliate ID');
  const raw = JSON.stringify(found);
  for (const secret of ['passwordHash', 'txnPasswordHash', 'refreshTokenHash', 'Hash']) assert.equal(raw.includes(secret), false, `no ${secret} in the list`);

  assert.equal((await m.c.call('POST', `/api/admin/members/${row.id}/active`, { isActive: false })).status, 403);
  assert.equal((await admin.call('POST', `/api/admin/members/${row.id}/active`, { isActive: 'no' })).status, 400);
  assert.equal((await admin.call('POST', `/api/admin/members/${row.id}/active`, { isActive: false })).status, 200);
  assert.equal((await m.c.call('GET', '/api/auth/me')).status, 401, 'signed out immediately');
  assert.equal((await new Client().call('POST', '/api/auth/login', { email: m.email, password: 'Password123' })).status >= 400, true, 'cannot log in while off');
  assert.equal((await admin.call('POST', `/api/admin/members/${row.id}/active`, { isActive: true })).status, 200);
  assert.equal((await new Client().call('POST', '/api/auth/login', { email: m.email, password: 'Password123' })).status, 200);

  // admin accounts are never switched off from here
  const adminRow = await prisma.user.findFirstOrThrow({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } } });
  assert.equal((await admin.call('POST', `/api/admin/members/${adminRow.id}/active`, { isActive: false })).status, 404);
});

test('SECURITY: a member verified by several racing requests is placed and counted exactly once', async () => {
  const top = await paidMember('RWCROOT', 'LEFT', 'mny_sec_top');
  const email = 'mny_sec_race@test.com';
  const c = new Client();
  assert.equal((await c.call('POST', '/api/auth/signup', { name: 'mny_sec_race', email, password: 'Password123', sponsorCode: top.left, leg: 'LEFT' })).status, 201);
  const mail = lastMail(email, 'verify')!;
  const token = tokenFromLink(mail.link!);
  const calls = [
    ...Array.from({ length: 4 }, () => new Client().call('GET', `/api/auth/verify-email/${token}`)),
    ...Array.from({ length: 4 }, () => new Client().call('POST', '/api/auth/verify-email-code', { email, code: mail.otp }))
  ];
  await Promise.all(calls);

  const row = await rowOf(email);
  assert.ok(row.parentId, 'placed');
  const upline = await prisma.user.findUniqueOrThrow({ where: { id: top.id } });
  assert.equal(upline.teamLeftNew + upline.teamLeftTotal >= 1, true);
  assert.equal(upline.teamLeftTotal, 1, 'counted once, not once per request');
  assert.equal(upline.teamLeftNew, 1);
});

test('SECURITY: two simultaneous upgrades of the same member charge once and pay the sponsor once', async () => {
  const prices = (await new Client().call('GET', '/api/packages/prices')).json.data as { PRO: number; ELITE: number };
  const top = await paidMember('RWCROOT', 'RIGHT', 'mny_sec_up');
  const mate = await signup(top.left, 'LEFT', 'mny_sec_mate');
  await setTxn(top.c);
  await addFund(top.c, prices.PRO * 3, 'UTR-SEC-UP');
  const code = (await rowOf(mate.email)).referralCode;
  const res = await Promise.all([1, 2, 3].map(() => top.c.call('POST', '/api/wallet/activate', { affiliateId: code, package: 'PRO', txnPassword: TXN })));
  assert.equal(res.filter((r) => r.status === 201).length, 1, 'exactly one upgrade goes through');
  assert.equal((await actOf(top.c)).activation, prices.PRO * 2, 'only one charge');
  assert.equal((await prisma.packagePurchase.count({ where: { userId: (await rowOf(mate.email)).id, status: 'CONFIRMED' } })), 1);
});

test('SECURITY: no one approves their own request, and a payment reference is credited once', async () => {
  // an admin is also a member: they can ask, but another admin must approve
  assert.equal((await admin.call('POST', '/api/wallet/fund', { ...FUND_PROOF, amount: 100, reference: 'UTR-OWN-1' })).status, 201);
  const own = ((await admin.call('GET', '/api/admin/fund-requests')).json.data.items as any[]).find((x) => x.reference === 'UTR-OWN-1');
  assert.equal((await admin.call('POST', `/api/admin/fund-requests/${own.id}/approve`)).status, 403);

  // the same reference from anyone else (any letter case) is refused while it is pending or approved
  const m = await signup('RWCROOT', 'LEFT', 'mny_sec_ref');
  assert.equal((await m.c.call('POST', '/api/wallet/fund', { ...FUND_PROOF, amount: 100, reference: 'utr-own-1' })).status, 409);
  await addFund(m.c, 100, 'UTR-REF-ONCE');
  assert.equal((await m.c.call('POST', '/api/wallet/fund', { ...FUND_PROOF, amount: 100, reference: 'utr-ref-once' })).status, 409, 'already credited');

  // admin cannot approve their own campaign report either
  const camp = (await admin.call('POST', '/api/admin/campaigns', { title: 'Own report test', description: '', reward: 10, url: 'https://example.com', videoUrl: '', needsProof: true, isActive: true })).json.data;
  const sent = await admin.call('POST', '/api/campaigns/reports', { campaignId: camp.id, holderName: 'Self Admin', mobile: '9000000001', fileName: 'p.png', fileData: REPORT_PNG });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.equal((await admin.call('POST', `/api/admin/reports/${sent.json.data.id}/approve`)).status, 403);
});

test('SECURITY: parallel transaction-password guesses cannot beat the 5-try limit; odd paging and names do not crash', async () => {
  const m = await signup('RWCROOT', 'LEFT', 'mny_sec_txn');
  assert.equal((await setTxn(m.c)).status, 200);
  const guesses = await Promise.all(Array.from({ length: 12 }, (_, i) => m.c.call('POST', '/api/wallet/transfer', { amount: 10, txnPassword: `guess${i}` })));
  assert.ok(guesses.filter((g) => g.status === 401).length <= 5, 'at most 5 get an answer about the password');
  assert.ok(guesses.some((g) => g.status === 429), 'the rest are locked out');
  assert.equal((await m.c.call('POST', '/api/wallet/transfer', { amount: 10, txnPassword: TXN })).status, 429, 'locked even for the right password');

  assert.equal((await admin.call('GET', '/api/admin/members?page=Infinity')).status, 200);
  assert.equal((await admin.call('GET', '/api/admin/members?page=99999999999999')).status, 200);
  assert.equal((await m.c.call('GET', '/api/wallet/transactions?page=Infinity')).status, 200);
  assert.equal((await admin.call('PUT', '/api/site/content/constructor', { items: [] })).status, 404);
  assert.equal((await admin.call('PUT', '/api/site/content/toString', { items: [] })).status, 404);
});

test('PAYMENT: the admin sets the QR and UPI details, and every payment must come with a transaction ID and a screenshot', async () => {
  const m = await signup('RWCROOT', 'LEFT', 'mny_pay_one');
  assert.equal((await new Client().call('GET', '/api/site/payment')).status, 401, 'members only');
  const empty = (await m.c.call('GET', '/api/site/payment')).json.data;
  assert.deepEqual([empty.upiId, empty.qrUrl], ['', null]);

  assert.equal((await m.c.call('PUT', '/api/site/content/payment', { upiId: 'rwc@upi', payeeName: 'RWC', note: '' })).status, 403);
  assert.equal((await admin.call('PUT', '/api/site/content/payment', { upiId: 'not a upi', payeeName: 'RWC', note: '' })).status, 400);
  assert.equal((await admin.call('PUT', '/api/site/content/payment', { upiId: 'rwc@okbank', payeeName: 'Rising Wealth', note: 'Pay the exact amount.' })).status, 200);
  assert.equal((await putImage(admin, 'payment-qr', PNG, 'image/png')).status, 200);
  assert.equal((await putImage(m.c, 'payment-qr', PNG, 'image/png')).status, 403, 'only an admin sets the QR');
  const shown = (await m.c.call('GET', '/api/site/payment')).json.data;
  assert.deepEqual([shown.upiId, shown.payeeName, shown.note], ['rwc@okbank', 'Rising Wealth', 'Pay the exact amount.']);
  assert.match(shown.qrUrl, /^\/api\/site\/assets\/payment-qr\?v=\d+$/);

  // fund request: amount + transaction ID + screenshot, all required
  const base = { amount: 500, reference: 'UTR-PAY-ONE' };
  assert.equal((await m.c.call('POST', '/api/wallet/fund', base)).status, 400, 'screenshot missing');
  assert.equal((await m.c.call('POST', '/api/wallet/fund', { ...base, fileName: 'x.png', fileData: Buffer.from('<html>no</html>').toString('base64') })).status, 400, 'must be a real image');
  assert.equal((await m.c.call('POST', '/api/wallet/fund', { ...base, fileName: 'x.png', fileData: 'A'.repeat(950_000) })).status, 413);
  const sent = await m.c.call('POST', '/api/wallet/fund', { ...base, ...FUND_PROOF });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));

  const listed = ((await admin.call('GET', '/api/admin/fund-requests')).json.data.items as any[]).find((x) => x.reference === 'UTR-PAY-ONE');
  assert.ok(listed);
  assert.equal(JSON.stringify(listed).includes('fileData'), false, 'the list never carries the picture');
  const proof = await admin.call('GET', `/api/admin/fund-requests/${listed.id}/proof`);
  assert.equal(proof.json.data.mime, 'image/png');
  assert.equal((await m.c.call('GET', `/api/admin/fund-requests/${listed.id}/proof`)).status, 403);

  // package purchase: same rules, and the picture never leaks through the member or admin lists
  const buyer = await signup('RWCROOT', 'RIGHT', 'mny_pay_two');
  const pbase = { package: 'PRO', reference: 'UTR-PAY-PKG' };
  assert.equal((await buyer.c.call('POST', '/api/packages/purchase', pbase)).status, 400, 'transaction ID and screenshot are required');
  assert.equal((await buyer.c.call('POST', '/api/packages/purchase', { package: 'PRO', fileName: 'p.png', fileData: PNG.toString('base64') })).status, 400, 'transaction ID is required');
  const bought = await buyer.c.call('POST', '/api/packages/purchase', { ...pbase, fileName: 'p.png', fileData: PNG.toString('base64') });
  assert.equal(bought.status, 201, JSON.stringify(bought.json));
  assert.equal(JSON.stringify(bought.json).includes('fileData'), false);
  assert.equal(JSON.stringify((await buyer.c.call('GET', '/api/packages/mine')).json).includes('fileData'), false);
  const pending = ((await admin.call('GET', '/api/admin/purchases?status=PENDING')).json.data.purchases as any[]).find((x) => x.reference === 'UTR-PAY-PKG');
  assert.ok(pending);
  assert.equal(JSON.stringify(pending).includes('fileData'), false);
  assert.equal((await admin.call('GET', `/api/admin/purchases/${pending.id}/proof`)).json.data.mime, 'image/png');
  assert.equal((await buyer.c.call('GET', `/api/admin/purchases/${pending.id}/proof`)).status, 403);
  const confirmed = await admin.call('POST', `/api/admin/purchases/${pending.id}/confirm`);
  assert.equal(confirmed.status, 200);
  assert.equal(JSON.stringify(confirmed.json).includes('fileData'), false);

  // the same transaction ID cannot pay twice
  const other = await signup('RWCROOT', 'RIGHT', 'mny_pay_three');
  assert.equal((await other.c.call('POST', '/api/packages/purchase', { package: 'PRO', reference: 'utr-pay-pkg', fileName: 'p.png', fileData: PNG.toString('base64') })).status, 409);
});

// ---------------------------------------------------------------- DEMAT CAMPAIGNS, AUTO PAYOUT, RANK PERKS, LIVE TRAININGS

test('DEMAT CAMPAIGN: approving a report runs the Demat plan: direct income for the member, passive for 5 sponsor levels', async () => {
  const top = await paidMember('RWCROOT', 'LEFT', 'mny_dm_top');
  const mid = await signup(top.left, 'LEFT', 'mny_dm_mid'); // Trainee, sponsored by top
  const midRow = await rowOf(mid.email);
  const leaf = await signup(midRow.leftCode!, 'LEFT', 'mny_dm_leaf'); // Trainee, sponsored by mid

  const camp = (await admin.call('POST', '/api/admin/campaigns', { title: 'Demat opening', description: '', reward: 1000, url: 'https://example.com/d', videoUrl: '', needsProof: true, isDemat: true, isActive: true })).json.data;
  assert.equal(camp.isDemat, true);
  const sent = await leaf.c.call('POST', '/api/campaigns/reports', { campaignId: camp.id, holderName: 'Asha Verma', mobile: '9111111111', fileName: 'p.png', fileData: REPORT_PNG });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));

  const w = async (c: Client) => rupees((await walletOf(c)).balance);
  const [leaf0, mid0, top0] = [await w(leaf.c), await w(mid.c), await w(top.c)];
  assert.equal((await admin.call('POST', `/api/admin/reports/${sent.json.data.id}/approve`)).status, 200);

  assert.equal((await w(leaf.c)) - leaf0, 1000, 'the member gets the Demat direct income');
  assert.equal((await w(mid.c)) - mid0, 50, 'sponsor level 1 earns 5% (even as a Trainee)');
  assert.equal((await w(top.c)) - top0, 30, 'sponsor level 2 earns 3%');
  const types = ((await leaf.c.call('GET', '/api/wallet/transactions')).json.data.items as any[]).map((e) => e.type);
  assert.ok(types.includes('DEMAT_DIRECT') && !types.includes('CAMPAIGN_REWARD'));
  const midTypes = ((await mid.c.call('GET', '/api/wallet/transactions')).json.data.items as any[]).map((e) => e.type);
  assert.ok(midTypes.includes('DEMAT_PASSIVE'));
  assert.equal(await prisma.dematReferral.count({ where: { clientName: 'Asha Verma' } }), 1, 'recorded like an admin-entered Demat referral');
  assert.equal((await leaf.c.call('GET', '/api/campaigns/stats')).json.data.earnings, 1000);
});

test('AUTO PAYOUT: the weekly window closes by itself once a new IST week has started, and only once', async () => {
  const { closePayoutIfDue } = await import('../features/income/payout.scheduler');
  const top = await paidMember('RWCROOT', 'RIGHT', 'mny_ap_top');
  for (const n of ['mny_ap_a', 'mny_ap_b', 'mny_ap_c']) {
    const m = await signup(top.left, 'LEFT', n);
    await buy(m.c, 'PRO'); // 3 PRO direct sales for top => one weekly share
  }
  const before = await prisma.payoutPeriod.count();
  const nextWeek = new Date(Date.now() + 8 * 86_400_000);

  assert.equal(await closePayoutIfDue(new Date(Date.now() - 86_400_000 * 400)), false, 'not due while the last period is from this week or later');
  const racing = await Promise.all([closePayoutIfDue(nextWeek), closePayoutIfDue(nextWeek), closePayoutIfDue(nextWeek)]);
  assert.equal(racing.filter(Boolean).length, 1, 'three servers waking up together close it exactly once');
  assert.equal(await prisma.payoutPeriod.count(), before + 1);
  assert.equal(await closePayoutIfDue(nextWeek), false, 'nothing new sold since');

  const period = await prisma.payoutPeriod.findFirstOrThrow({ orderBy: { endsAt: 'desc' } });
  assert.equal(period.closedBy, 'system');
  const weekly = ((await top.c.call('GET', '/api/wallet/transactions')).json.data.items as any[]).filter((e) => e.type === 'WEEKLY_BONUS');
  assert.equal(weekly.length, 1);
  assert.ok(Number(weekly[0].amount) >= 375, 'at least the plan minimum for one PRO share');
});

test('RANK PERKS: the admin sets a perk per rank, members who reached it can claim once, an admin approves', async () => {
  const m = await signup('RWCROOT', 'LEFT', 'mny_pk_one');
  const row = await rowOf(m.email);

  assert.equal((await m.c.call('PUT', '/api/site/content/rankPerks', { items: [] })).status, 403);
  assert.equal((await admin.call('PUT', '/api/site/content/rankPerks', { items: [{ rank: 'KING', title: 'Bike', description: '' }] })).status, 400, 'unknown rank');
  const perks = [
    { rank: 'SILVER', title: 'Gift hamper', description: 'Delivered to your address' },
    { rank: 'GOLD', title: 'Goa trip', description: 'Up to Rs 25,000 value' }
  ];
  assert.equal((await admin.call('PUT', '/api/site/content/rankPerks', { items: perks })).status, 200);

  const list = (await m.c.call('GET', '/api/team/ranks')).json.data;
  assert.equal(list.items.length, 16);
  assert.deepEqual(list.items.slice(0, 3).map((r: any) => [r.rank, r.status, r.reward]), [['SILVER', 'NEXT', 750], ['GOLD', 'LOCKED', 1500], ['PLATINUM', 'LOCKED', 3000]]);
  assert.equal(list.items[0].perk.title, 'Gift hamper');
  assert.equal(list.items[2].perk, null);

  assert.equal((await m.c.call('POST', '/api/team/perks/SILVER/claim')).status, 403, 'rank not reached');
  await prisma.user.update({ where: { id: row.id }, data: { rank: 'SILVER' } });
  assert.equal((await m.c.call('POST', '/api/team/perks/GOLD/claim')).status, 403, 'a higher rank is still locked');
  assert.equal((await m.c.call('POST', '/api/team/perks/PLATINUM/claim')).status, 403);
  assert.equal((await m.c.call('POST', '/api/team/perks/NOPE/claim')).status, 404);
  assert.equal((await m.c.call('POST', '/api/team/perks/SILVER/claim')).status, 201);
  assert.equal((await m.c.call('POST', '/api/team/perks/SILVER/claim')).status, 409, 'once per rank');
  const after = (await m.c.call('GET', '/api/team/ranks')).json.data.items;
  assert.deepEqual([after[0].status, after[0].claim.status, after[1].status], ['ACHIEVED', 'PENDING', 'NEXT']);

  // a rank with no perk set cannot be claimed
  await prisma.user.update({ where: { id: row.id }, data: { rank: 'PLATINUM' } });
  assert.equal((await m.c.call('POST', '/api/team/perks/PLATINUM/claim')).status, 404);

  const claim = ((await admin.call('GET', '/api/admin/perk-claims')).json.data.items as any[]).find((c) => c.user.email === m.email);
  assert.ok(claim);
  assert.equal((await m.c.call('POST', `/api/admin/perk-claims/${claim.id}/approve`)).status, 403);
  assert.equal((await admin.call('POST', `/api/admin/perk-claims/${claim.id}/approve`)).status, 200);
  assert.equal((await admin.call('POST', `/api/admin/perk-claims/${claim.id}/approve`)).status, 409);
  assert.equal(((await m.c.call('GET', '/api/team/ranks')).json.data.items[0].claim.status), 'APPROVED');
  await admin.call('PUT', '/api/site/content/rankPerks', { items: [] });
});

test('LIVE TRAININGS: members see the schedule, but the join link only comes with the right package', async () => {
  const trainee = await signup('RWCROOT', 'LEFT', 'mny_lv_one');
  const pro = await paidMember('RWCROOT', 'LEFT', 'mny_lv_pro');
  const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const base = { description: 'Weekly session', link: 'https://meet.example.com/abc', minTier: 'TRAINEE', isActive: true };

  assert.equal((await trainee.c.call('POST', '/api/admin/live', { ...base, title: 'Nope', startsAt: hours(2) })).status, 403);
  assert.equal((await admin.call('POST', '/api/admin/live', { ...base, title: 'Bad link', startsAt: hours(2), link: 'http://x.com' })).status, 400);
  assert.equal((await admin.call('POST', '/api/admin/live', { ...base, title: 'No date', startsAt: 'soon' })).status, 400);

  const open = await admin.call('POST', '/api/admin/live', { ...base, title: 'Open class', startsAt: hours(5) });
  const proOnly = await admin.call('POST', '/api/admin/live', { ...base, title: 'Pro masterclass', startsAt: hours(6), minTier: 'PRO', link: 'https://meet.example.com/pro-secret' });
  await admin.call('POST', '/api/admin/live', { ...base, title: 'Long gone', startsAt: hours(-30) });
  await admin.call('POST', '/api/admin/live', { ...base, title: 'Hidden', startsAt: hours(7), isActive: false });
  assert.equal(open.status, 201);

  const seen = (await trainee.c.call('GET', '/api/live')).json;
  const titles = (seen.data.items as any[]).map((s) => s.title);
  assert.ok(titles.includes('Open class') && titles.includes('Pro masterclass'));
  assert.ok(!titles.includes('Long gone') && !titles.includes('Hidden'), 'old and switched-off sessions are not listed');
  assert.equal(JSON.stringify(seen).includes('pro-secret'), false, 'the PRO link never reaches a trainee');
  const row = (seen.data.items as any[]).find((s) => s.title === 'Open class');
  assert.equal(row.unlocked, true);
  assert.equal(row.link, 'https://meet.example.com/abc');
  assert.equal((seen.data.items as any[]).find((s) => s.title === 'Pro masterclass').unlocked, false);

  const proSees = ((await pro.c.call('GET', '/api/live')).json.data.items as any[]).find((s) => s.title === 'Pro masterclass');
  assert.equal(proSees.link, 'https://meet.example.com/pro-secret');
  assert.equal((await new Client().call('GET', '/api/live')).status, 401);
  assert.equal(((await admin.call('GET', '/api/live')).json.data.items as any[]).every((s) => s.unlocked), true, 'admins see every link');

  assert.equal((await admin.call('PUT', `/api/admin/live/${proOnly.json.data.id}`, { ...base, title: 'Pro masterclass v2', startsAt: hours(6), minTier: 'ELITE', link: 'https://meet.example.com/pro-secret' })).status, 200);
  assert.equal(((await pro.c.call('GET', '/api/live')).json.data.items as any[]).find((s) => s.title === 'Pro masterclass v2').unlocked, false, 'raising the tier locks it again');
  assert.equal((await admin.call('DELETE', `/api/admin/live/${proOnly.json.data.id}`)).status, 200);
});

test('integrity: every wallet balance equals the sum of its ledger entries', async () => {
  const users = await prisma.user.findMany({ select: { id: true, email: true, walletBalance: true } });
  for (const u of users) {
    const agg = await prisma.ledgerEntry.aggregate({ where: { userId: u.id }, _sum: { amount: true } });
    assert.equal(
      rupees(u.walletBalance.toString()),
      rupees((agg._sum.amount ?? 0).toString()),
      `ledger mismatch for ${u.email}`
    );
  }
});

test('integrity: no negative balances and binary rule (one child per leg) holds', async () => {
  assert.equal(await prisma.user.count({ where: { walletBalance: { lt: 0 } } }), 0);
  const dup = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c FROM (
      SELECT "parentId", leg FROM "User" WHERE "parentId" IS NOT NULL GROUP BY 1,2 HAVING COUNT(*) > 1
    ) x`;
  assert.equal(Number(dup[0].c), 0);
});
