import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, PASSWORD, same, sameCookie, sameRows } from '../lib.js';

let acct: Awaited<ReturnType<typeof accounts>>;
beforeAll(async () => { acct = await accounts(); });
beforeEach(flushRedis);

describe('login', () => {
  it('missing fields', async () => same(await new Pair().req('POST', '/api/auth/login/', { json: { email: 'x@y.com' } })));
  it('unknown email', async () => same(await new Pair().req('POST', '/api/auth/login/', { json: { email: 'nobody@example.com', password: 'whatever1' } })));
  it('wrong password', async () => same(await new Pair().req('POST', '/api/auth/login/', { json: { email: acct.user!.email, password: 'wrong-password' } })));
  it('email is case-insensitive', async () => {
    const r = await new Pair().req('POST', '/api/auth/login/', { json: { email: acct.user!.email.toUpperCase(), password: PASSWORD } });
    expect(r.django.status).toBe(200);
    same(r);
  });
  for (const role of ['user', 'agent', 'customer', 'admin', 'superadmin']) {
    it(`success as ${role}`, async () => {
      if (!acct[role]) return;
      const p = new Pair();
      const r = await p.login(acct[role]!.email);
      expect(r.django.status).toBe(200);
      same(r);
      sameCookie(r, 'refresh_token');
      same(await p.req('GET', '/api/auth/me/'));
    });
  }
  it('throttles after 5/min (anon)', async () => {
    const p = new Pair();
    let last;
    for (let i = 0; i < 6; i++) last = await p.req('POST', '/api/auth/login/', { json: { email: 'nobody@example.com', password: 'x' } });
    expect(last!.django.status).toBe(429);
    same(last!, { headers: ['retry-after'] });
  });
});

describe('me / token handling', () => {
  it('no credentials → 401', async () => same(await new Pair().req('GET', '/api/auth/me/'), { headers: ['www-authenticate'] }));
  it('garbage token → 401', async () => same(await new Pair().req('GET', '/api/auth/me/', { token: 'abc.def.ghi' }), { headers: ['www-authenticate'] }));
  it('Django-issued token works on Express (shared signing key)', async () => {
    const p = new Pair();
    await p.login(acct.user!.email);
    const r = await p.req('GET', '/api/auth/me/', { token: p.django.token });
    expect(r.express.status).toBe(200);
    same(r);
  });
  it('wrong method → 405 after auth', async () => same(await new Pair().req('POST', '/api/auth/me/'), { headers: ['www-authenticate'] }));
});

describe('refresh rotation & logout', () => {
  it('rotates, rejects reuse, logout clears cookie', async () => {
    const p = new Pair();
    await p.login(acct.user!.email);
    const oldCookies = { django: new Map(p.django.cookies), express: new Map(p.express.cookies) };

    const r1 = await p.req('POST', '/api/auth/refresh-token/');
    expect(r1.django.status).toBe(200);
    same(r1);
    sameCookie(r1, 'refresh_token');

    // replay the pre-rotation refresh token → blacklisted → 401 + cookie deleted
    const replay = new Pair();
    replay.django.cookies = oldCookies.django; replay.express.cookies = oldCookies.express;
    const r2 = await replay.req('POST', '/api/auth/refresh-token/');
    same(r2);
    sameCookie(r2, 'refresh_token');

    const r3 = await p.req('POST', '/api/auth/logout/');
    expect(r3.django.status).toBe(205);
    same(r3);
    sameCookie(r3, 'refresh_token');
  });
  it('no refresh token → 400', async () => same(await new Pair().req('POST', '/api/auth/refresh-token/')));
});

describe('register', () => {
  const base = { first_name: 'Parity', last_name: 'Tester', password: 'longenough1', password2: 'longenough1', age_confirmed: true };
  it('missing fields', async () => same(await new Pair().req('POST', '/api/auth/register/', { json: { email: 'a@b.com' } })));
  it('age not confirmed', async () => same(await new Pair().req('POST', '/api/auth/register/', { json: { ...base, email: 'p1@example.com', age_confirmed: false } })));
  it('password mismatch', async () => same(await new Pair().req('POST', '/api/auth/register/', { json: { ...base, email: 'p1@example.com', password2: 'different1' } })));
  it('invalid email', async () => same(await new Pair().req('POST', '/api/auth/register/', { json: { ...base, email: 'not-an-email' } })));
  it('short password', async () => same(await new Pair().req('POST', '/api/auth/register/', { json: { ...base, email: 'p1@example.com', password: 'short', password2: 'short' } })));
  it('existing verified email', async () => same(await new Pair().req('POST', '/api/auth/register/', { json: { ...base, email: acct.user!.email } })));

  it('creates the same user, profile and signup event', async () => {
    const email = `parity.${Date.now()}@example.com`;
    const r = await new Pair().req('POST', '/api/auth/register/', { json: { ...base, email } });
    expect(r.django.status).toBe(201);
    same(r);
    const ignore = ['password', 'email_verification_token', 'date_joined', 'email_verification_token_expires_at'];
    await sameRows('users_user', `email = '${email}'`, { ignore });
    await sameRows('users_profile', `user_id = (SELECT id FROM users_user WHERE email = '${email}')`);
    await sameRows('notifications_notificationpreference', `user_id = (SELECT id FROM users_user WHERE email = '${email}')`, { ignore: ['created_at', 'updated_at'] });
    await sameRows('trustsafety_accountsignupevent', `user_id = (SELECT id FROM users_user WHERE email = '${email}')`, { ignore: ['created_at'] });

    // unverified account can't log in yet (inactive → ModelBackend rejects → 401)
    same(await new Pair().req('POST', '/api/auth/login/', { json: { email, password: base.password } }));

    // re-registering the pending signup re-sends the link (200)
    same(await new Pair().req('POST', '/api/auth/register/', { json: { ...base, email, first_name: 'Again' } }));
    await sameRows('users_user', `email = '${email}'`, { ignore });

    // verify via each side's own token (POST → JSON), then login works on both
    const tok = async (side: 'django' | 'express') =>
      (await dbs[side].query('SELECT email_verification_token t FROM users_user WHERE email = $1', [email])).rows[0].t as string;
    const [td, te] = await Promise.all([tok('django'), tok('express')]);
    const p = new Pair();
    const [vd, ve] = await Promise.all([
      p.django.req('POST', '/api/auth/verify-email/', { json: { token: td } }),
      p.express.req('POST', '/api/auth/verify-email/', { json: { token: te } }),
    ]);
    same({ django: vd, express: ve });
    await sameRows('users_user', `email = '${email}'`, { ignore });
    const login = await p.login(email, base.password);
    expect(login.django.status).toBe(200);
    same(login);
  });
});

describe('verify-email / resend / password reset', () => {
  it('missing token', async () => same(await new Pair().req('POST', '/api/auth/verify-email/', { json: {} })));
  it('bad token (JSON)', async () => same(await new Pair().req('POST', '/api/auth/verify-email/', { json: { token: 'nope' } })));
  it('bad token (HTML page)', async () => {
    const r = await new Pair().req('GET', '/api/auth/verify-email/?token=nope');
    expect(r.express.status).toBe(r.django.status);
    expect(r.express.text).toBe(r.django.text);
  });
  it('resend is generic', async () => same(await new Pair().req('POST', '/api/auth/resend-verification/', { json: { email: acct.user!.email } })));
  it('password reset request (known + unknown)', async () => {
    same(await new Pair().req('POST', '/api/auth/password-reset/', { json: { email: acct.user!.email } }));
    same(await new Pair().req('POST', '/api/auth/password-reset/', { json: { email: 'nobody@example.com' } }));
  });
  it('password reset confirm errors', async () => {
    const p = new Pair();
    same(await p.req('POST', '/api/auth/password-reset-confirm/', { json: { token: 'x' } }));
    same(await p.req('POST', '/api/auth/password-reset-confirm/', { json: { token: 'x', password: 'abcdefgh1', password2: 'abcdefgh2' } }));
    same(await p.req('POST', '/api/auth/password-reset-confirm/', { json: { token: 'x', password: 'abcdefgh1', password2: 'abcdefgh1' } }));
  });
  it('google: missing / invalid token', async () => {
    same(await new Pair().req('POST', '/api/auth/google/', { json: {} }));
    same(await new Pair().req('POST', '/api/auth/google/', { json: { id_token: 'not-a-jwt' } }));
  });
});

describe('token claims (SimpleJWT format)', () => {
  const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
  const header = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[0]!, 'base64url').toString()) as Record<string, unknown>;
  const shape = (c: Record<string, unknown>) => ({ keys: Object.keys(c), user_id: c.user_id, token_type: c.token_type, life: (c.exp as number) - (c.iat as number) });
  it('access + refresh tokens carry the same claims, in the same order (incl. iat), on both sides', async () => {
    const p = new Pair();
    const r = await p.login(acct.user!.email);
    expect(r.django.status).toBe(200);
    const access = { django: (r.django.body as { access: string }).access, express: (r.express.body as { access: string }).access };
    expect(Object.keys(claims(access.express))).toContain('iat');
    expect(shape(claims(access.express))).toEqual(shape(claims(access.django)));
    expect(header(access.express)).toEqual(header(access.django));
    const refresh = { django: p.django.cookies.get('refresh_token')!, express: p.express.cookies.get('refresh_token')! };
    expect(shape(claims(refresh.express))).toEqual(shape(claims(refresh.django)));
    // rotated pair
    const r1 = await p.req('POST', '/api/auth/refresh-token/');
    expect(r1.django.status).toBe(200);
    const a1 = { django: (r1.django.body as { access: string }).access, express: (r1.express.body as { access: string }).access };
    expect(shape(claims(a1.express))).toEqual(shape(claims(a1.django)));
    expect(shape(claims(p.express.cookies.get('refresh_token')!))).toEqual(shape(claims(p.django.cookies.get('refresh_token')!)));
  });
});
