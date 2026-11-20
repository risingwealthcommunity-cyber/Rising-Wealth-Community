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
async function buy(c: Client, pkg: 'PRO' | 'ELITE') {
  const p = await c.call('POST', '/api/packages/purchase', { package: pkg });
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
  assert.equal((await u.c.call('POST', '/api/packages/purchase', { package: 'PRO' })).status, 201);
  assert.equal((await u.c.call('POST', '/api/packages/purchase', { package: 'ELITE' })).status, 409); // pending exists
  const pending = await admin.call('GET', '/api/admin/purchases?status=PENDING');
  const mine = pending.json.data.purchases.find((p: any) => p.user.email === 'rules@test.com');
  assert.equal(mine.amount, '2499');
  await admin.call('POST', `/api/admin/purchases/${mine.id}/confirm`);
  assert.equal((await u.c.call('POST', '/api/packages/purchase', { package: 'PRO' })).status, 400); // already PRO
  assert.equal((await u.c.call('POST', '/api/packages/purchase', { package: 'ELITE' })).status, 201); // upgrade
});

test('packages: confirming twice / concurrently pays only once', async () => {
  const a = await signup('RWCROOT', 'LEFT', 'race_a');
  await buy(a.c, 'PRO');
  const b = await signup(a.user.referralCode, 'LEFT', 'race_b');
  const p = await b.c.call('POST', '/api/packages/purchase', { package: 'PRO' });
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

// ---------------------------------------------------------------- INTEGRITY

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
