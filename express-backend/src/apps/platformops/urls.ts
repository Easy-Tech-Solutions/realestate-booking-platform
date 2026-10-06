// platformops — /api/platform-ops/ (port of platformops/views.py + urls.py + serializers.py).
//
// Server-local inputs: log files are read from $LOG_DIR (default /app/logs,
// Django's BASE_DIR/logs) and docs from $DOCS_DIR (default /app/docs, the
// ./docs bind mount on the Django backend service).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { hasAnyPermission } from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction, requireDepartment } from '../../domain/superadmin.js';
import { drf, isoformat } from '../../lib/datetime.js';
import { NotFound, notFoundFor } from '../../lib/errors.js';
import { queue } from '../../lib/jobs.js';
import { redis } from '../../lib/redis.js';
import { apiView, IsAuthenticated, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { validate, type FieldSpec } from '../../lib/fields.js';
import { pyIntPk } from '../../lib/py.js';
import { collectMetrics, diskUsage, round1 } from './metrics.js';

const LOG_DIR = process.env.LOG_DIR ?? '/app/logs';
const DOCS_DIR = process.env.DOCS_DIR ?? '/app/docs';
const ENGINEERING_REQUIRED = 'Platform & Engineering access required';

async function requireEngineering(req: ApiRequest): Promise<boolean> {
  const user = req.user;
  if (!isSuperadminStaff(user)) return false;
  return (await requireDepartment(user, 'engineering'))
    || (await hasAnyPermission(user, 'infrastructure.feature_flags'))
    || (await hasAnyPermission(user, 'infrastructure.system_caches'));
}

const forbid = (res: Response) => res.status(403).json({ error: ENGINEERING_REQUIRED });

// --- serializers -------------------------------------------------------------------

type FlagRow = { id: number; key: string; name: string; description: string; is_enabled: boolean; updated_by_id: number | null; updated_at: string; created_at: string };

async function serializeFlag(f: FlagRow) {
  const u = f.updated_by_id === null ? null : await db.selectFrom('users_user').select('username').where('id', '=', f.updated_by_id).executeTakeFirst();
  return {
    id: f.id, key: f.key, name: f.name, description: f.description, is_enabled: f.is_enabled,
    updated_by: f.updated_by_id, updated_by_username: u ? u.username : null,
    updated_at: drf(f.updated_at), created_at: drf(f.created_at),
  };
}

const flagRepr = (f: { key: string; is_enabled: boolean }) => `${f.key} (${f.is_enabled ? 'on' : 'off'})`;

const FLAG_FIELDS: FieldSpec[] = [
  {
    name: 'key', kind: 'slug', required: true, maxLength: 60,
    unique: { table: 'platformops_featureflag', column: 'key', message: 'feature flag with this key already exists.' },
    validate: (v) => String(v).trim().toLowerCase().replace(/ /g, '_'),
  },
  { name: 'name', kind: 'char', required: true, maxLength: 120 },
  { name: 'description', kind: 'char', required: false, allowBlank: true },
  { name: 'is_enabled', kind: 'bool', required: false },
];

// --- feature flags -----------------------------------------------------------------

const r = djangoRouter('api/platform-ops/');

r.path('feature-flags/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireEngineering(req))) return forbid(res);
    const flags = await db.selectFrom('platformops_featureflag').selectAll().orderBy('key').execute();
    const out = [];
    for (const f of flags) out.push(await serializeFlag(f as FlagRow));
    return out;
  },
  async POST(req, res) {
    if (!(await requireEngineering(req))) return forbid(res);
    const { errors, values } = await validate(req.body === undefined ? {} : req.body, FLAG_FIELDS);
    if (errors) return res.status(400).json(errors);
    const now = new Date();
    const flag = await db.insertInto('platformops_featureflag').values({
      key: values.key as string, name: values.name as string, description: (values.description as string | undefined) ?? '',
      is_enabled: (values.is_enabled as boolean | undefined) ?? false, updated_by_id: req.user!.id, updated_at: now, created_at: now,
    }).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'feature_flag.create', {
      target: auditTarget('FeatureFlag', flag.id, flagRepr(flag)), reason: flag.description, metadata: { is_enabled: flag.is_enabled },
    });
    return res.status(201).json(await serializeFlag(flag as FlagRow));
  },
}));

r.path('feature-flags/<int:pk>/', apiView({
  permissions: [IsAuthenticated],
  async PATCH(req, res) {
    if (!(await requireEngineering(req))) return forbid(res);
    const flag = await db.selectFrom('platformops_featureflag').selectAll().where('id', '=', Number(req.params.pk)).executeTakeFirst();
    if (!flag) throw notFoundFor('FeatureFlag');
    const { errors, values } = await validate(req.body === undefined ? {} : req.body, FLAG_FIELDS, { partial: true, instanceId: flag.id });
    if (errors) return res.status(400).json(errors);
    const updated = await db.updateTable('platformops_featureflag')
      .set({ ...values, updated_by_id: req.user!.id, updated_at: new Date() })
      .where('id', '=', flag.id).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'feature_flag.update', {
      target: auditTarget('FeatureFlag', updated.id, flagRepr(updated)), reason: updated.description, metadata: { is_enabled: updated.is_enabled },
    });
    return serializeFlag(updated as FlagRow);
  },
  async DELETE(req, res) {
    if (!(await requireEngineering(req))) return forbid(res);
    const flag = await db.selectFrom('platformops_featureflag').selectAll().where('id', '=', Number(req.params.pk)).executeTakeFirst();
    if (!flag) throw notFoundFor('FeatureFlag');
    await logAdminAction(req, 'feature_flag.delete', { target: auditTarget('FeatureFlag', flag.id, flagRepr(flag)) });
    await db.deleteFrom('platformops_featureflag').where('id', '=', flag.id).execute();
    return res.status(204).end();
  },
}));

// --- system health -------------------------------------------------------------------

const errStr = (e: unknown) => (e instanceof Error ? e.message : String(e));

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

async function checkDatabase() {
  try { await sql`SELECT 1`.execute(db); return { ok: true }; } catch (e) { return { ok: false, error: errStr(e) }; }
}

async function checkRedis() {
  try { await withTimeout(redis.ping(), 2000, 'Timeout connecting to server'); return { ok: true }; } catch (e) { return { ok: false, error: errStr(e) }; }
}

async function checkWorkers() {
  // celery inspect().ping() equivalent: BullMQ workers connected to our queues.
  try {
    const names: string[] = [];
    for (const qn of ['celery', 'ai_scoring']) {
      const ws = await withTimeout(queue(qn).getWorkers(), 2000, 'timeout');
      for (const w of ws) names.push(`celery@${w.name || w.addr || w.id}`);
    }
    return { ok: names.length > 0, worker_count: names.length, workers: names };
  } catch (e) {
    return { ok: false, error: errStr(e) };
  }
}

function checkDisk() {
  try {
    const u = diskUsage('/');
    return { ok: u.percent < 90, total_gb: round1(u.total / 1e9), free_gb: round1(u.free / 1e9), used_percent: round1(u.percent) };
  } catch (e) {
    return { ok: false, error: errStr(e) };
  }
}

function readLines(path: string): string[] {
  // Python readlines(): keeps line endings, last line may lack one.
  const text = readFileSync(path, 'utf8');
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function tryJson(line: string): { ok: true; v: unknown } | { ok: false } {
  try { return { ok: true, v: JSON.parse(line) }; } catch { return { ok: false }; }
}

function recentErrorCount(minutes = 60): number {
  const path = join(LOG_DIR, 'errors.log');
  if (!existsSync(path)) return 0;
  const cutoff = Date.now() - minutes * 60_000;
  let count = 0;
  try {
    const lines = readLines(path).slice(-2000);
    for (const line of lines) {
      const j = tryJson(line);
      if (!j.ok) continue;
      const entry = j.v;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return count; // AttributeError → outer except
      const ts = (entry as Record<string, unknown>).ts;
      if (ts) {
        const s = String(ts);
        const hasTz = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
        const t = Date.parse(hasTz ? s : s + 'Z');
        if (Number.isNaN(t)) continue;
        if (t >= cutoff) count++;
      } else {
        count++;
      }
    }
  } catch {
    return count;
  }
  return count;
}

r.path('system-health/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireEngineering(req))) return forbid(res);
    const hbs = await db.selectFrom('platformops_taskheartbeat').selectAll().execute(); // unordered, like TaskHeartbeat.objects.all()
    return {
      database: await checkDatabase(),
      redis: await checkRedis(),
      celery_workers: await checkWorkers(),
      disk: checkDisk(),
      recent_errors_last_hour: recentErrorCount(60),
      scheduled_tasks: hbs.map((h) => ({
        id: h.id, task_name: h.task_name, last_run_at: drf(h.last_run_at as string | null), last_success: h.last_success,
        last_error: h.last_error, run_count: h.run_count,
      })),
    };
  },
}));

/** Python int() on a query param (ValueError → unhandled → 500). */
function queryInt(v: unknown, fallback: number): number {
  if (v === undefined) return fallback;
  const s = Array.isArray(v) ? String(v.at(-1)) : String(v);
  return pyIntPk(s);
}

r.path('recent-errors/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireEngineering(req))) return forbid(res);
    const limit = Math.min(queryInt(req.query.limit, 100), 500);
    const path = join(LOG_DIR, 'errors.log');
    if (!existsSync(path)) return [];
    const entries: unknown[] = [];
    try {
      const lines = readLines(path).slice(-limit);
      for (const line of lines.reverse()) {
        const j = tryJson(line);
        entries.push(j.ok ? j.v : { raw: line.trim() });
      }
    } catch (e) {
      return res.status(500).json({ error: errStr(e) });
    }
    return entries;
  },
}));

r.path('flush-cache/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await requireEngineering(req))) return forbid(res);
    // cache.clear() on Django's RedisCache is FLUSHDB of the cache database.
    try {
      await redis.flushdb();
    } catch (e) {
      return res.status(500).json({ error: `Cache flush failed: ${errStr(e)}` });
    }
    await logAdminAction(req, 'infrastructure.cache_flush');
    return { ok: true, message: 'Cache cleared.' };
  },
}));

const LOG_FILES: Record<string, string> = {
  application: 'application.log',
  activity: 'activity.log',
  transactions: 'transactions.log',
  errors: 'errors.log',
};

r.path('server-metrics/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireEngineering(req))) return forbid(res);
    const rows = await db.selectFrom('platformops_servermetricsnapshot').selectAll().orderBy('recorded_at', 'desc').limit(288).execute();
    const history = rows.reverse().map((s) => ({
      recorded_at: isoformat(s.recorded_at as string),
      cpu_percent: s.cpu_percent,
      memory_percent: s.memory_percent,
      memory_used_mb: s.memory_used_mb,
      disk_used_percent: s.disk_used_percent,
      disk_free_gb: s.disk_free_gb,
      net_bytes_sent_mb: s.net_bytes_sent_mb,
      net_bytes_recv_mb: s.net_bytes_recv_mb,
    }));
    return { live: await collectMetrics(), history };
  },
}));

const DOCS_SLUGS: Record<string, string> = {
  'user-guide': 'user-guide.html',
  'management-portal-guide': 'management-portal-guide.html',
  'developer-guide': 'developer-guide.html',
};

r.path('docs/<slug:slug>/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!isSuperadminStaff(req.user)) { res.status(403).setHeader('Content-Type', 'text/plain'); return res.end('Forbidden'); }
    const slug = String(req.params.slug);
    const filename = Object.hasOwn(DOCS_SLUGS, slug) ? DOCS_SLUGS[slug] : undefined;
    if (!filename) throw new NotFound();
    const path = join(DOCS_DIR, filename);
    if (!existsSync(path)) throw new NotFound();
    return res.status(200).type('text/html; charset=utf-8').send(readFileSync(path, 'utf8'));
  },
}));

r.path('log-viewer/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireEngineering(req))) return forbid(res);
    const q = (k: string, d: string) => { const v = req.query[k]; return v === undefined ? d : Array.isArray(v) ? String(v.at(-1)) : String(v); };
    const fileKey = q('file', 'errors');
    if (!Object.hasOwn(LOG_FILES, fileKey)) {
      return res.status(400).json({ error: `Unknown log file. Choose from: ${Object.keys(LOG_FILES).join(', ')}` });
    }
    const limit = Math.min(queryInt(req.query.limit, 200), 500);
    const levelFilter = q('level', '').toUpperCase();
    const search = q('search', '').toLowerCase();
    const path = join(LOG_DIR, LOG_FILES[fileKey]!);
    if (!existsSync(path)) return [];
    const entries: Record<string, unknown>[] = [];
    try {
      const lines = readLines(path).slice(-limit * 3);
      for (let line of lines.reverse()) {
        line = line.trim();
        if (!line) continue;
        const j = tryJson(line);
        const entry = (j.ok ? j.v : { raw: line }) as Record<string, unknown>;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`'${Array.isArray(entry) ? 'list' : typeof entry}' object has no attribute 'get'`);
        if (levelFilter && String(entry.level ?? '').toUpperCase() !== levelFilter) continue;
        if (search) {
          const hay = String(entry.msg || entry.raw || '').toLowerCase();
          if (!hay.includes(search)) continue;
        }
        const MAX = 4000;
        for (const field of ['msg', 'raw', 'exception']) {
          const v = entry[field];
          if (typeof v === 'string' && [...v].length > MAX) {
            entry[field] = [...v].slice(0, MAX).join('');
            entry.truncated = true;
          }
        }
        entries.push(entry);
        if (entries.length >= limit) break;
      }
    } catch (e) {
      return res.status(500).json({ error: errStr(e) });
    }
    return entries;
  },
}));
