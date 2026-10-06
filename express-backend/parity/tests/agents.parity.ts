// Parity tests for agents: /api/agents/ — applying to become a sourcing agent
// (multipart + image validation), the 3-stage review queue/decisions (RBAC +
// Django model permissions), the agent dashboard (commissions) and agent
// property sourcing (Listing + PropertyVerification on the Ops account).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, dbs, flushRedis, Pair, same, sameRows } from '../lib.js';

type Acct = { id: number; email: string };
let acct: Record<string, Acct>;
let APPLICANT: Acct, SECOND: Acct;
let N0 = 0, A0 = 0, LMAX = 0;
const AGENT415 = 'rhykimgolee256@gmail.com';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const png = (name: string) => new File([PNG], name, { type: 'image/png' });
const both = async (q: string, params: unknown[] = []) => {
  const [d, e] = await Promise.all([dbs.django.query(q, params), dbs.express.query(q, params)]);
  return { django: d.rows, express: e.rows };
};
async function login(email: string) { await flushRedis(); const p = new Pair(); await p.login(email); return p; }
const notifs = () => sameRows('notifications_notification', `id > ${N0}`);
const audit = () => sameRows('superadmin_adminauditlog', `id > ${A0}`);
function form(fields: Record<string, string | File | File[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const f of v) fd.append(k, f);
    else fd.append(k, v);
  }
  return fd;
}

beforeAll(async () => {
  acct = await accounts();
  APPLICANT = acct.user!; SECOND = acct.customer!;
  await both(`UPDATE users_user SET password = (SELECT password FROM users_user WHERE id = ${APPLICANT.id}) WHERE id = 415`);
  // close any open applications of the test users so they can apply
  await both(`UPDATE agents_agentapplication SET status = 'declined' WHERE applicant_id IN (${APPLICANT.id}, ${SECOND.id})`);
  await both(`DELETE FROM agents_agentprofile WHERE user_id IN (${APPLICANT.id}, ${SECOND.id})`);
  // commissions for the dashboard of agent 415 (listing 191 is sourced by 415)
  for (const [id, status, amount] of [[93001, 'pending', '1.25'], [93002, 'paid', '10.505'], [93003, 'voided', '3.00']] as const) {
    await both(`INSERT INTO bookings_booking (id, listing_id, customer_id, start_date, end_date, status, notes, requested_at, owner_notes, decline_reason,
      total_price, service_fee, requires_viewing, extension_reason) VALUES (${id}, 191, 60, '2027-01-0${id - 93000}', '2027-02-01', 'confirmed', '', now(), '', '', '200.00', '8.00', false, '')`);
    await both(`INSERT INTO agents_agentcommission (booking_id, agent_id, listing_id, booking_amount, amount, currency, status, reference, notes, created_at, updated_at)
      VALUES (${id}, 415, ${id === 93003 ? 'NULL' : 191}, 192.00, ${amount}, 'USD', '${status}', '', '', now() - interval '${id - 93000} hours', now())`);
  }
  N0 = Number((await dbs.django.query('SELECT coalesce(max(id), 0) AS m FROM notifications_notification')).rows[0].m);
  A0 = Number((await dbs.django.query('SELECT coalesce(max(id), 0) AS m FROM superadmin_adminauditlog')).rows[0].m);
  LMAX = Number((await dbs.django.query('SELECT coalesce(max(id), 0) AS m FROM listings_listing WHERE id < 9000')).rows[0].m);
});
beforeEach(flushRedis);

describe('access', () => {
  it('anonymous → 401', async () => {
    const p = new Pair();
    for (const [m, path] of [['POST', '/api/agents/applications/'], ['GET', '/api/agents/applications/me/'], ['GET', '/api/agents/applications/review-queue/'],
      ['POST', '/api/agents/applications/1/review/'], ['GET', '/api/agents/dashboard/'], ['POST', '/api/agents/list-property/']] as const) {
      same(await p.req(m, path, { json: {} }), { headers: ['www-authenticate'] });
    }
  });
  it('405s and review-queue/role matrix', async () => {
    for (const who of ['user', 'agent', 'customer', 'admin', 'superadmin']) {
      const p = await login(acct[who]!.email);
      same(await p.req('GET', '/api/agents/applications/'));
      same(await p.req('POST', '/api/agents/dashboard/'));
      same(await p.req('GET', '/api/agents/applications/review-queue/'));
      same(await p.req('GET', '/api/agents/applications/me/'));
      same(await p.req('GET', '/api/agents/dashboard/'));
      same(await p.req('POST', '/api/agents/applications/99999999/review/', { json: { approve: true } }));
      same(await p.req('POST', '/api/agents/list-property/', { json: {} }));
    }
  });
});

describe('applications', () => {
  let a: Pair;
  beforeAll(async () => { a = await login(APPLICANT.email); });
  it('validation', async () => {
    same(await a.req('POST', '/api/agents/applications/', { json: {} }));
    same(await a.req('POST', '/api/agents/applications/', { json: [] }));
    same(await a.req('POST', '/api/agents/applications/', { json: { full_name: 'A', address: 'B', phone: 'C', id_document: 'x', agreement_accepted: true } }));
    same(await a.req('POST', '/api/agents/applications/', { form: form({ full_name: 'A' }) }));
    same(await a.req('POST', '/api/agents/applications/', { form: form({ full_name: 'A', address: 'B', phone: '1'.repeat(31), id_document: png('id.png'), agreement_accepted: 'false' }) }));
    same(await a.req('POST', '/api/agents/applications/', { form: form({ full_name: 'A', address: 'B', phone: '1', id_document: new File([Buffer.from('not an image')], 'id.png'), agreement_accepted: 'yes' }) }));
    same(await a.req('POST', '/api/agents/applications/', { form: form({ full_name: 'A', address: 'B', phone: '1', id_document: new File([], 'empty.png'), agreement_accepted: 'yes' }) }));
    same(await a.req('POST', '/api/agents/applications/', { form: form({ full_name: '  ', address: 'B', phone: '1', id_document: png(`${'n'.repeat(101)}.png`), agreement_accepted: 'maybe' }) }));
    await sameRows('agents_agentapplication', 'true');
  });
  it('apply, duplicate, me', async () => {
    const r = await a.req('POST', '/api/agents/applications/', { form: form({ full_name: ' Irene  ', address: 'Sinkor', phone: '0880123456', id_document: png('my id.front.png'), agreement_accepted: 'true' }) });
    same(r);
    expect(r.django.status, r.django.text).toBe(201);
    same(await a.req('POST', '/api/agents/applications/', { form: form({ full_name: 'Again', address: 'x', phone: '1', id_document: png('id2.png'), agreement_accepted: 'on' }) }));
    const s = await login(SECOND.email);
    same(await s.req('POST', '/api/agents/applications/', { form: form({ full_name: 'Second', address: 'Paynesville', phone: '0770', id_document: png('second.png'), agreement_accepted: '1' }) }));
    same(await a.req('GET', '/api/agents/applications/me/'));
    same(await s.req('GET', '/api/agents/applications/me/'));
    await sameRows('agents_agentapplication', 'true');
    await notifs();
  });
  it('review: queue, reason required, approve through all stages, decline', async () => {
    const sa = await login(acct.superadmin!.email);
    same(await sa.req('GET', '/api/agents/applications/review-queue/'));
    const { rows } = await dbs.django.query(`SELECT id, applicant_id FROM agents_agentapplication WHERE applicant_id IN (${APPLICANT.id}, ${SECOND.id}) AND status = 'submitted' ORDER BY id`);
    const first = Number(rows.find((r) => Number(r.applicant_id) === APPLICANT.id).id);
    const second = Number(rows.find((r) => Number(r.applicant_id) === SECOND.id).id);
    same(await (await login(acct.user!.email)).req('POST', `/api/agents/applications/${first}/review/`, { json: { approve: true } }));
    for (const json of [{}, { approve: false }, { approve: 0, reason: '   ' }]) {
      same(await sa.req('POST', `/api/agents/applications/${first}/review/`, { json }));
    }
    same(await sa.req('POST', `/api/agents/applications/${first}/review/`, { json: { approve: 'false' } })); // truthy string → approve (PS)
    same(await sa.req('POST', `/api/agents/applications/${first}/review/`, { json: { approve: 1 } })); // compliance
    same(await sa.req('GET', '/api/agents/applications/review-queue/'));
    same(await sa.req('POST', `/api/agents/applications/${first}/review/`, { json: { approve: true, reason: 'ok' } })); // supervisor → approved
    same(await sa.req('POST', `/api/agents/applications/${first}/review/`, { json: { approve: true } })); // not awaiting review
    same(await sa.req('POST', `/api/agents/applications/${second}/review/`, { json: { approve: true } }));
    // reason=None → str(None) = 'None' passes the "reason required" check and is stored (Django quirk)
    same(await sa.req('POST', `/api/agents/applications/${second}/review/`, { json: { approve: '', reason: null } }));
    same(await sa.req('POST', `/api/agents/applications/${second}/review/`, { json: { approve: false, reason: 'Docs unclear' } }));
    await sameRows('agents_agentapplication', 'true');
    await sameRows('agents_agentprofile', 'true');
    await audit();
    await notifs();
    same(await (await login(APPLICANT.email)).req('GET', '/api/agents/applications/me/'));
    same(await (await login(SECOND.email)).req('GET', '/api/agents/applications/me/'));
  });
});

describe('dashboard', () => {
  it('approved agent with commissions; new agent; non-agent', async () => {
    same(await (await login(AGENT415)).req('GET', '/api/agents/dashboard/'));
    same(await (await login(APPLICANT.email)).req('GET', '/api/agents/dashboard/'));
    same(await (await login(SECOND.email)).req('GET', '/api/agents/dashboard/'));
  });
});

describe('list-property', () => {
  it('owner-field and listing validation', async () => {
    const a = await login(APPLICANT.email);
    same(await (await login(SECOND.email)).req('POST', '/api/agents/list-property/', { json: {} }));
    const owner = { owner_name: 'Real Owner', owner_phone: '0880', owner_payout_number: '0881', owner_consent: 'yes' };
    for (const json of [{}, { owner_name: ' ', owner_consent: true }, { ...owner, owner_consent: 'no' }, owner,
      { ...owner, title: 'T' }, { ...owner, title: 'T', address: 'A', property_type: 'castle' }, { ...owner, title: 'T', address: 'A', price: '1.00' },
      { ...owner, title: 'T', address: 'A', amenities: 'wifi' }, { ...owner, title: 'T', address: 'A', amenities: { a: 1 } },
      { ...owner, title: 'T', address: 'A', bedrooms: 'x', privacy_type: 'castle', latitude: '1234.5', lease_term_months: 0, payment_schedule: 'weekly' },
      { ...owner, status: 'draft', title: '', price: '-5' }]) {
      same(await a.req('POST', '/api/agents/list-property/', { json }));
    }
    await sameRows('listings_listing', `id > ${LMAX} AND id < 9000`);
  });
  it('success (JSON and multipart with images)', async () => {
    const a = await login(APPLICANT.email);
    const r = await a.req('POST', '/api/agents/list-property/', { json: {
      owner_name: ' Real Owner ', owner_phone: '0880', owner_payout_number: '0881', owner_consent: true, owner_email: 'o@example.com', owner_payout_network: 'mtn',
      title: '  Agent Flat ', address: '5 Tubman Blvd', price: '45.5', property_type: 'Apartment', amenities: ['wifi', 'ac'], highlights: '["quiet"]',
      bedrooms: 2, pricing_type: 'monthly', payment_schedule: 'quarterly', lease_term_months: 12, latitude: 6.3, status: 'published', is_available: true,
      deed_volume_number: 'V-12', page_number: 7,
    } });
    same(r);
    expect(r.django.status).toBe(201);
    const fd = form({
      owner_name: 'Owner Two', owner_phone: '0770', owner_payout_number: '0771', owner_consent: 'on', title: 'Form Flat', address: '',
      property_location: 'Behind the market', amenities: '["tv"]', main_image: png('front.png'), gallery_images: [png('g1.png'), png('g2.png')],
      self_checkin: 'true', price: '', latitude: '',
    });
    same(await a.req('POST', '/api/agents/list-property/', { form: fd }));
    const fd2 = form({
      owner_name: 'Owner Three', owner_phone: '0770', owner_payout_number: '0771', owner_consent: 'on', title: 'Form Flat 2', address: 'Street 9',
      main_image: png('front2.png'), weekend_premium_percent: '5', gallery_images: [png('g1.png'), png('g2.png'), png('g3.png')],
    });
    same(await a.req('POST', '/api/agents/list-property/', { form: fd2 }));
    await sameRows('listings_listing', `id > ${LMAX} AND id < 9000`);
    await sameRows('listings_listingimage', `listing_id > ${LMAX} AND listing_id < 9000`);
    await sameRows('propertyverifications_propertyverification', `listing_id > ${LMAX} AND listing_id < 9000`);
    await notifs();
    same(await a.req('GET', '/api/agents/dashboard/'));
  });
});
