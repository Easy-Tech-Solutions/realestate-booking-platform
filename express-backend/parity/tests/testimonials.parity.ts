// Parity tests for testimonials (/api/testimonials/) and newsletter (/api/newsletter/).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, same, sameRows, type Side } from '../lib.js';

let acct: Awaited<ReturnType<typeof accounts>>;
async function as(email: string) { await flushRedis(); const p = new Pair(); const r = await p.login(email); expect(r.django.status).toBe(200); return p; }
const maxId = async (t: string) => Number((await dbs.django.query(`SELECT coalesce(max(id), 0) AS m FROM ${t}`)).rows[0].m);

beforeAll(async () => { acct = await accounts(); });
beforeEach(flushRedis);

describe('testimonials', () => {
  it('public list', async () => {
    same(await new Pair().req('GET', '/api/testimonials/'));
    same(await new Pair().req('GET', '/api/testimonials/', { token: 'bad.token.here' }), { headers: ['www-authenticate'] });
  });
  it('anonymous POST → 401 (custom body)', async () => same(await new Pair().req('POST', '/api/testimonials/', { json: { quote: 'hello world' } })));
  it('validation', async () => {
    const p = await as(acct.user!.email);
    for (const body of [{}, ['x'], { quote: 'abc' }, { quote: 'x'.repeat(1001) }, { quote: 'great place', rating: 0 }, { quote: 'great place', rating: 6 },
      { quote: 'great place', rating: 'five' }, { quote: 'great place', rating: 4.5 }, { quote: 'great place', rating: null }, { quote: 'great place', rating: true },
      { quote: 'great place', location: 'x'.repeat(151) }, { quote: null }, { quote: 12345 }, { quote: '     ' }]) {
      same(await p.req('POST', '/api/testimonials/', { json: body }));
    }
  });
  it('create (various users) + list', async () => {
    const start = await maxId('testimonials_testimonial');
    for (const [email, body] of [
      [acct.user!.email, { quote: '  Loved the stay!  ', location: 'Monrovia', rating: '4.0' }],
      [acct.agent!.email, { quote: 'Great hosts here', rating: 3 }],
      [acct.customer!.email, { quote: 'Smooth booking' }],
      [acct.admin!.email, { quote: 'Admin says hi', location: '' }],
    ] as const) {
      const p = await as(email);
      const r = await p.req('POST', '/api/testimonials/', { json: body });
      expect(r.django.status, r.django.text).toBe(201);
      same(r);
    }
    await sameRows('testimonials_testimonial', `id > ${start}`, { ignore: ['created_at'] });
    same(await new Pair().req('GET', '/api/testimonials/'));
  });
});

describe('newsletter', () => {
  it('subscribe validation', async () => {
    const p = new Pair();
    for (const body of [{}, ['a'], { email: 'nope' }, { email: '' }, { email: 5 }, { email: 'a@example.com', first_name: 'x'.repeat(101) },
      { email: 'a@example.com', interests: 'hotels' }, { email: 'a@example.com', interests: [1, '', null, 'x'.repeat(51)] },
      { email: 'a@example.com', interests: null }, { email: 'a@example.com', interests: { a: 1 } }]) {
      same(await p.req('POST', '/api/newsletter/subscribe/', { json: body }));
    }
  });
  it('subscribe → already → unsubscribe → resubscribe', async () => {
    const p = new Pair();
    const email = 'News.Letter@Example.com';
    same(await p.req('POST', '/api/newsletter/subscribe/', { json: { email: `  ${email} `, first_name: ' Ann ', interests: ['hotels', ' deals '] } }));
    await sameRows('newsletter_subscriber', "email = 'news.letter@example.com'", { ignore: ['subscribed_at', 'unsubscribe_token', 'id'] });
    same(await p.req('POST', '/api/newsletter/subscribe/', { json: { email } }));
    for (const body of [{}, { token: '' }, { token: 'nope' }, { token: 5 }]) same(await p.req('POST', '/api/newsletter/unsubscribe/', { json: body }));
    const tok = async (s: Side) => (await dbs[s].query("SELECT unsubscribe_token t FROM newsletter_subscriber WHERE email = 'news.letter@example.com'")).rows[0].t as string;
    const [td, te] = await Promise.all([tok('django'), tok('express')]);
    expect(te).toMatch(/^[\w-]{64}$/);
    for (let i = 0; i < 2; i++) {
      const [d, e] = await Promise.all([
        p.django.req('POST', '/api/newsletter/unsubscribe/', { json: { token: ` ${td} ` } }),
        p.express.req('POST', '/api/newsletter/unsubscribe/', { json: { token: ` ${te} ` } })]);
      same({ django: d, express: e });
      await sameRows('newsletter_subscriber', "email = 'news.letter@example.com'", { ignore: ['subscribed_at', 'unsubscribe_token', 'id', 'unsubscribed_at'] });
    }
    same(await p.req('POST', '/api/newsletter/subscribe/', { json: { email, interests: [] } }));
    await sameRows('newsletter_subscriber', "email = 'news.letter@example.com'", { ignore: ['subscribed_at', 'unsubscribe_token', 'id'] });
    // form-encoded with repeated interests
    const fd = new FormData(); fd.append('email', 'form.sub@example.com'); fd.append('interests', 'a'); fd.append('interests', 'b');
    same(await p.req('POST', '/api/newsletter/subscribe/', { form: fd }));
    await sameRows('newsletter_subscriber', "email = 'form.sub@example.com'", { ignore: ['subscribed_at', 'unsubscribe_token', 'id'] });
  });
  it('wrong methods', async () => {
    same(await new Pair().req('GET', '/api/newsletter/subscribe/'));
    same(await new Pair().req('GET', '/api/newsletter/unsubscribe/'));
  });
});
