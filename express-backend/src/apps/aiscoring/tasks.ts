// aiscoring.tasks — the four scoring tasks (queue 'ai_scoring', the celery-ai
// worker) + the worker_ready warmup (aiscoring.worker_warmup).

import { db } from '../../db/index.js';
import { isFeatureEnabled, recordTaskHeartbeat } from '../../domain/platformops.js';
import { config } from '../../config.js';
import { defineTask } from '../../lib/jobs.js';
import { logger } from '../../lib/logger.js';
import { ModelUnavailable, warmup } from './model_service.js';
import { scoreFraudFlag, scoreHostApplication, scoreListingFlag, scorePropertyVerification, type ScoreResult } from './scorer.js';

const log = logger.child({ logger: 'aiscoring.tasks' });
type Row = Record<string, any>;

const aiScoringEnabled = () => isFeatureEnabled('ai_scoring_enabled', false);
const SKIPPED = { skipped: 'ai_scoring_enabled is off' } as const;

class DoesNotExist extends Error {}

/** Model.objects.get(pk=x) — DoesNotExist / ValueError messages as Django words them. */
async function getOrRaise(table: string, model: string, pk: unknown): Promise<Row> {
  let id: number;
  if (typeof pk === 'boolean') id = pk ? 1 : 0;
  else if (typeof pk === 'number' && Number.isFinite(pk)) id = Math.trunc(pk);
  else if (typeof pk === 'string' && /^\s*[+-]?\d+\s*$/.test(pk)) id = Number(pk.trim());
  else throw new TypeError(`Field 'id' expected a number but got ${typeof pk === 'string' ? `'${pk}'` : JSON.stringify(pk)}.`);
  const row = await db.selectFrom(table as 'trustsafety_fraudflag').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw new DoesNotExist(`${model} matching query does not exist.`);
  return row as Row;
}

/**
 * The shared task body: flag gate → load → score → save(update_fields) → heartbeat.
 * ModelUnavailable is logged and swallowed (task returns None); anything else
 * records a failed heartbeat and re-raises.
 */
async function runScoring(
  taskName: string, what: string, id: unknown,
  load: () => Promise<Row>, score: (row: Row) => Promise<ScoreResult>, save: (row: Row, r: ScoreResult) => Promise<void>,
): Promise<ScoreResult | typeof SKIPPED | null> {
  if (!(await aiScoringEnabled())) return SKIPPED;
  try {
    const row = await load();
    const result = await score(row);
    await save(row, result);
    await recordTaskHeartbeat(taskName, true);
    return result;
  } catch (exc) {
    const msg = (exc as Error)?.message ?? String(exc);
    await recordTaskHeartbeat(taskName, false, msg);
    if (exc instanceof ModelUnavailable) {
      log.warn(`${taskName}: ${msg}`);
      return null;
    }
    log.error({ err: exc }, `${taskName} failed for ${what} #${id}`);
    throw exc;
  }
}

export function scoreFraudFlagTask(flagId: unknown) {
  return runScoring('aiscoring.tasks.score_fraud_flag_task', 'flag', flagId,
    () => getOrRaise('trustsafety_fraudflag', 'FraudFlag', flagId),
    scoreFraudFlag,
    async (f, r) => { await db.updateTable('trustsafety_fraudflag').set({ ai_score: r.score, ai_rationale: r.rationale }).where('id', '=', f.id).execute(); });
}

export function scoreListingFlagTask(flagId: unknown) {
  return runScoring('aiscoring.tasks.score_listing_flag_task', 'flag', flagId,
    async () => {
      const f = await getOrRaise('inventory_listingflag', 'ListingFlag', flagId);
      f.listing = f.listing_id === null ? null : (await db.selectFrom('listings_listing').selectAll().where('id', '=', f.listing_id).executeTakeFirst()) ?? null;
      return f;
    },
    (f) => scoreListingFlag(f as Row & { listing: Row | null }),
    async (f, r) => { await db.updateTable('inventory_listingflag').set({ ai_score: r.score, ai_rationale: r.rationale }).where('id', '=', f.id).execute(); });
}

export function scoreHostApplicationTask(applicationId: unknown) {
  return runScoring('aiscoring.tasks.score_host_application_task', 'application', applicationId,
    () => getOrRaise('hostapplications_hostapplication', 'HostApplication', applicationId),
    scoreHostApplication,
    async (a, r) => { await db.updateTable('hostapplications_hostapplication').set({ ai_risk_score: r.score, ai_rationale: r.rationale }).where('id', '=', a.id).execute(); });
}

export function scorePropertyVerificationTask(verificationId: unknown) {
  return runScoring('aiscoring.tasks.score_property_verification_task', 'verification', verificationId,
    () => getOrRaise('propertyverifications_propertyverification', 'PropertyVerification', verificationId),
    scorePropertyVerification,
    async (v, r) => { await db.updateTable('propertyverifications_propertyverification').set({ ai_risk_score: r.score, ai_rationale: r.rationale }).where('id', '=', v.id).execute(); });
}

const Q = { queue: 'ai_scoring' };
defineTask('aiscoring.tasks.score_fraud_flag_task', scoreFraudFlagTask, Q);
defineTask('aiscoring.tasks.score_listing_flag_task', scoreListingFlagTask, Q);
defineTask('aiscoring.tasks.score_host_application_task', scoreHostApplicationTask, Q);
defineTask('aiscoring.tasks.score_property_verification_task', scorePropertyVerificationTask, Q);

// aiscoring.worker_warmup: celery-ai runs `-I aiscoring.worker_warmup`, whose worker_ready hook
// warms the model. Equivalent: a worker process consuming the ai_scoring queue warms up once
// after start (this module is also imported by the API process via domain/aiscoring — no warmup there).
const isWorkerProcess = /(^|\/)worker\.(js|ts)$/.test(process.argv[1] ?? '');
const queues = (process.env.QUEUES ?? '').split(',').filter(Boolean);
if (isWorkerProcess && config.jobsEnabled && (!queues.length || queues.includes('ai_scoring'))) {
  setImmediate(() => { warmup().catch(() => undefined); });
}
