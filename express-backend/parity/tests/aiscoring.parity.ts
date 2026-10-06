// aiscoring — the four Celery tasks (queue 'ai_scoring'), run directly on the
// Express side against express_copy with fixtures created identically in both
// copies. Neither side has the GGUF model file, so this exercises exactly the
// "model unavailable" behaviour plus every non-model path (feature flag off,
// missing row, bad pk, prompt-building errors).
//
// The Django side can't be driven from this container (no Celery worker in the
// parity stack), so the expected values below are Django's own outputs: the
// same calls were run through `aiscoring.tasks.<task>(arg)` in parity-django
// against django_copy with these fixtures (.scratch-superadmin/dj_tasks.py) and
// the resulting rows diffed table-for-table against express_copy — see the
// port report. The assertions pin those results.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Redis } from 'ioredis';
import { beforeAll, describe, expect, it } from 'vitest';
import { dbs } from '../lib.js';

const DIST = process.env.DIST ?? (existsSync('/app/dist/apps/aiscoring/tasks.js') ? 'dist' : 'dist-superadmin');

async function both(q: string, params: unknown[] = []) {
  const [d, e] = await Promise.all([dbs.django.query(q, params), dbs.express.query(q, params)]);
  return { django: d.rows, express: e.rows };
}

type Outcome = { ok: unknown } | { raised: string; msg: string };
/** Runs aiscoring task bodies in a fresh Node process against express_copy (like the BullMQ worker would). */
function runExpressTasks(calls: [string, unknown][]): Promise<Outcome[]> {
  const code = `
    const t = await import('/app/${DIST}/apps/aiscoring/tasks.js');
    const { pool } = await import('/app/${DIST}/db/index.js');
    const { redis } = await import('/app/${DIST}/lib/redis.js');
    const fns = { score_fraud_flag_task: t.scoreFraudFlagTask, score_listing_flag_task: t.scoreListingFlagTask,
      score_host_application_task: t.scoreHostApplicationTask, score_property_verification_task: t.scorePropertyVerificationTask };
    const out = [];
    for (const [name, arg] of JSON.parse(process.env.CALLS)) {
      try { const r = await fns[name](arg); out.push({ ok: r ?? null }); }
      catch (e) { out.push({ raised: e.constructor.name, msg: e.message }); }
    }
    await pool.end(); redis.disconnect();
    process.stdout.write('@@RESULT@@' + JSON.stringify(out)); process.exit(0);`;
  const env = { ...process.env, CALLS: JSON.stringify(calls), POSTGRES_HOST: 'parity-db', POSTGRES_PORT: '5432', POSTGRES_DB: 'express_copy', POSTGRES_USER: 'parity',
    REDIS_URL: 'redis://parity-redis:6379/2', DJANGO_SECRET_KEY: 'parity-unused', EMAIL_BACKEND_MODE: 'console', LOG_LEVEL: 'silent' };
  return new Promise((resolve, reject) => execFile('node', ['--input-type=module', '-e', code], { env, cwd: '/app' }, (err, stdout, stderr) => {
    const i = stdout.lastIndexOf('@@RESULT@@');
    if (i < 0) return reject(new Error(`${err}\n${stderr}`));
    resolve(JSON.parse(stdout.slice(i + 10)));
  }));
}

const FF = 930001; const FF2 = 930002; const LF = 930011; const LF_BAD = 930012; const LF_NONE = 930013;
let HA: number; let PV: number; let L_OK: number; let L_BAD: number;
const MODEL_MSG = 'AI model file not found at /app/ai_models/qwen2.5-0.5b-instruct-q4_k_m.gguf — run `python manage.py download_ai_model` first.';

beforeAll(async () => {
  HA = Number((await dbs.django.query('SELECT id FROM hostapplications_hostapplication ORDER BY id LIMIT 1')).rows[0].id);
  PV = Number((await dbs.django.query('SELECT id FROM propertyverifications_propertyverification ORDER BY id LIMIT 1')).rows[0].id);
  const ls = (await dbs.django.query('SELECT id FROM listings_listing ORDER BY id LIMIT 2')).rows.map((r) => Number(r.id));
  L_OK = ls[0]!; L_BAD = ls[1]!;
  await both(`UPDATE listings_listing SET amenities = '[1, "wifi"]'::jsonb WHERE id = $1`, [L_BAD]);
  await both(`INSERT INTO trustsafety_fraudflag (id, user_id, flag_type, severity, status, details, ai_score, ai_rationale, reviewed_by_id, reviewed_at, review_notes, created_at)
    VALUES ($1, NULL, 'rapid_signup', 'high', 'open', '5 accounts from 10.0.0.1', NULL, '', NULL, NULL, '', '2026-10-01T00:00:00Z'),
           ($2, NULL, 'weird_type', 'extreme', 'open', '', NULL, '', NULL, NULL, '', '2026-10-01T00:00:00Z')`, [FF, FF2]);
  await both(`INSERT INTO inventory_listingflag (id, listing_id, flag_type, severity, status, details, ai_score, ai_rationale, reviewed_by_id, reviewed_at, review_notes, created_at)
    VALUES ($1, $4, 'price_anomaly', 'medium', 'open', 'price 10x median', NULL, '', NULL, NULL, '', '2026-10-01T00:00:00Z'),
           ($2, $5, 'duplicate', 'low', 'open', 'same title', NULL, '', NULL, NULL, '', '2026-10-01T00:00:00Z'),
           ($3, NULL, 'manual', 'low', 'open', '', NULL, '', NULL, NULL, '', '2026-10-01T00:00:00Z')`, [LF, LF_BAD, LF_NONE, L_OK, L_BAD]);
});

const calls = (): [string, unknown][] => [
  ['score_fraud_flag_task', FF], ['score_fraud_flag_task', FF2], ['score_fraud_flag_task', 999999], ['score_fraud_flag_task', 'abc'],
  ['score_listing_flag_task', LF], ['score_listing_flag_task', LF_BAD], ['score_listing_flag_task', LF_NONE], ['score_listing_flag_task', 999999],
  ['score_host_application_task', HA], ['score_host_application_task', 999999],
  ['score_property_verification_task', PV], ['score_property_verification_task', 999999],
];

// Django's outcomes for calls() with ai_scoring_enabled on and no model file.
const DJANGO_ON: Outcome[] = [
  { ok: null }, { ok: null },
  { raised: 'DoesNotExist', msg: 'FraudFlag matching query does not exist.' },
  { raised: 'ValueError', msg: "Field 'id' expected a number but got 'abc'." },
  { ok: null },
  { raised: 'TypeError', msg: 'sequence item 0: expected str instance, int found' },
  { ok: null },
  { raised: 'DoesNotExist', msg: 'ListingFlag matching query does not exist.' },
  { raised: 'AttributeError', msg: "'HostApplication' object has no attribute 'phone'" },
  { raised: 'DoesNotExist', msg: 'HostApplication matching query does not exist.' },
  { ok: null },
  { raised: 'DoesNotExist', msg: 'PropertyVerification matching query does not exist.' },
];
// TaskHeartbeat rows Django leaves behind for the same calls (run_count delta, last_success, last_error).
const DJANGO_HEARTBEATS: Record<string, { runs: number; last_success: boolean; last_error: string }> = {
  'aiscoring.tasks.score_fraud_flag_task': { runs: 4, last_success: false, last_error: "Field 'id' expected a number but got 'abc'." },
  'aiscoring.tasks.score_listing_flag_task': { runs: 4, last_success: false, last_error: 'ListingFlag matching query does not exist.' },
  'aiscoring.tasks.score_host_application_task': { runs: 2, last_success: false, last_error: 'HostApplication matching query does not exist.' },
  'aiscoring.tasks.score_property_verification_task': { runs: 2, last_success: false, last_error: 'PropertyVerification matching query does not exist.' },
};

async function heartbeats() {
  const { rows } = await dbs.express.query("SELECT task_name, run_count, last_success, last_error, last_run_at FROM platformops_taskheartbeat WHERE task_name LIKE 'aiscoring.%' ORDER BY task_name");
  return Object.fromEntries(rows.map((r) => [r.task_name as string, r]));
}

describe('aiscoring tasks', () => {
  it('ai_scoring_enabled off → skipped, no heartbeat, nothing written', async () => {
    await both("UPDATE platformops_featureflag SET is_enabled = false WHERE key = 'ai_scoring_enabled'");
    const before = await heartbeats();
    const out = await runExpressTasks(calls());
    expect(out).toEqual(calls().map(() => ({ ok: { skipped: 'ai_scoring_enabled is off' } })));
    expect(await heartbeats()).toEqual(before);
  });

  it('ai_scoring_enabled on, no model → Django outcomes + heartbeats; rows untouched', async () => {
    await both("UPDATE platformops_featureflag SET is_enabled = true WHERE key = 'ai_scoring_enabled'");
    const before = await heartbeats();
    const out = await runExpressTasks(calls());
    expect(out.map((o) => ('raised' in o ? { raised: o.raised === 'Error' ? '?' : o.raised, msg: o.msg } : o)).map((o, i) => {
      // exception class names are Python's on the Django side; compare the message + "it raised"
      const dj = DJANGO_ON[i]!;
      return 'raised' in o && 'raised' in dj ? { raised: true, msg: o.msg } : o;
    })).toEqual(DJANGO_ON.map((o) => ('raised' in o ? { raised: true, msg: o.msg } : o)));
    const after = await heartbeats();
    for (const [task, exp] of Object.entries(DJANGO_HEARTBEATS)) {
      const a = after[task]!; const b = before[task];
      expect(Number(a.run_count) - Number(b?.run_count ?? 0), task).toBe(exp.runs);
      expect(a.last_success, task).toBe(exp.last_success);
      expect(a.last_error, task).toBe(exp.last_error);
    }
    // the ModelUnavailable path records the model message as the failure (checked on a fresh run)
    await runExpressTasks([['score_property_verification_task', PV]]);
    expect((await heartbeats())['aiscoring.tasks.score_property_verification_task'].last_error).toBe(MODEL_MSG);
    expect((await heartbeats())['aiscoring.tasks.score_property_verification_task'].last_success).toBe(false);
    // nothing scored
    const flags = await dbs.express.query(`SELECT ai_score, ai_rationale FROM trustsafety_fraudflag WHERE id IN (${FF}, ${FF2})
      UNION ALL SELECT ai_score, ai_rationale FROM inventory_listingflag WHERE id IN (${LF}, ${LF_BAD}, ${LF_NONE})`);
    expect(flags.rows.every((r) => r.ai_score === null && r.ai_rationale === '')).toBe(true);
  });

  it('domain/aiscoring enqueues on the ai_scoring queue (what celery-ai consumes)', async () => {
    const code = `
      const d = await import('/app/${DIST}/domain/aiscoring.js');
      const { delay } = await import('/app/${DIST}/lib/jobs.js');
      const { redis } = await import('/app/${DIST}/lib/redis.js');
      const { pool } = await import('/app/${DIST}/db/index.js');
      await d.delayAiScoring('score_fraud_flag_task', 5);
      await d.enqueueAiTask('chatbot.tasks.get_chatbot_reply_task', ['s', 'm'], 'job-1');
      await delay('aiscoring.tasks.score_property_verification_task', [7]);   // plain lib/jobs delay routes by the task's queue
      await pool.end(); redis.disconnect(); process.stdout.write('@@RESULT@@ok'); process.exit(0);`;
    const env = { ...process.env, POSTGRES_HOST: 'parity-db', POSTGRES_DB: 'express_copy', POSTGRES_USER: 'parity', REDIS_URL: 'redis://parity-redis:6379/5', DJANGO_SECRET_KEY: 'x', LOG_LEVEL: 'silent' };
    await new Promise<void>((resolve, reject) => execFile('node', ['--input-type=module', '-e', code], { env, cwd: '/app' }, (err, stdout, stderr) => (stdout.includes('@@RESULT@@') ? resolve() : reject(new Error(`${err}\n${stderr}`)))));
    const r = new Redis('redis://parity-redis:6379/5');
    try {
      const ids = await r.lrange('hk:ai_scoring:wait', 0, -1);
      const jobs = await Promise.all(ids.map(async (id) => { const j = await r.hgetall(`hk:ai_scoring:${id}`); return `${j.name}(${JSON.stringify(JSON.parse(j.data!).args)})`; }));
      expect(jobs.sort()).toEqual(['aiscoring.tasks.score_fraud_flag_task([5])', 'aiscoring.tasks.score_property_verification_task([7])', 'chatbot.tasks.get_chatbot_reply_task(["s","m"])']);
      expect(await r.lrange('hk:celery:wait', 0, -1)).toEqual([]);
      await r.flushdb();
    } finally { r.disconnect(); }
  });
});
