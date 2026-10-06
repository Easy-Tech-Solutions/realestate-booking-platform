// Celery worker + beat equivalent. While this backend is on standby
// (EXPRESS_JOBS_ENABLED=false) it stays idle, so scheduled jobs — emails,
// reservation expiry, payout reconciliation — never run in both backends.

import { Worker } from 'bullmq';
import { config } from './config.js';
import { loadAppModules } from './lib/apps.js';
import { queue, schedules, taskQueue, tasks } from './lib/jobs.js';
import { logger } from './lib/logger.js';
import { redis } from './lib/redis.js';

if (!config.jobsEnabled) {
  logger.info('EXPRESS_JOBS_ENABLED=false — worker idle (standby mode)');
  setInterval(() => undefined, 1 << 30);
} else {
  const apps = await loadAppModules('tasks');
  const queueNames = new Set([...tasks.values()].map((t) => t.queue).concat('celery'));
  // QUEUES=ai_scoring runs only that queue (the celery-ai equivalent).
  const only = (process.env.QUEUES ?? '').split(',').filter(Boolean);
  for (const name of queueNames) {
    if (only.length && !only.includes(name)) continue;
    new Worker(name, async (job) => {
      const def = tasks.get(job.name);
      if (!def) throw new Error(`Unknown task ${job.name}`);
      return def.fn(...((job.data?.args ?? []) as never[]));
    }, { connection: redis, prefix: 'hk', concurrency: name === 'ai_scoring' ? 1 : 2 })
      .on('failed', (job, err) => logger.error({ task: job?.name, err }, 'task failed'));
  }
  if (!only.length || only.includes('celery')) {
    for (const s of schedules) {
      await queue(taskQueue(s.task)).upsertJobScheduler(s.key, { pattern: s.cron, tz: 'UTC' }, { name: s.task, data: { args: s.args } });
    }
  }
  logger.info({ apps, queues: [...queueNames], schedules: schedules.length }, 'worker started');
}
