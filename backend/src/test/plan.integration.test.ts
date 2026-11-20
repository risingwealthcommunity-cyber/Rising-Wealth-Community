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

let outbox: { to: string; kind: string; link?: string; otp?: string }[] = [];
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
  fs.rmSync(dataDir, { recursive: true, force: true });
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
