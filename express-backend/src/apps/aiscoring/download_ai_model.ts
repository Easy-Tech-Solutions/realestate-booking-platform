// aiscoring/management/commands/download_ai_model.py — run by the Express AI
// worker before it starts (`node dist/apps/aiscoring/download_ai_model.js && node dist/worker.js`),
// like celery-ai runs `python manage.py download_ai_model` first.
//
// Same settings (AI_MODEL_DIR / AI_MODEL_FILENAME / AI_MODEL_URL / AI_MODEL_SHA256,
// same defaults), same behaviour: idempotent (an existing file whose sha256
// matches is kept), `--force` re-downloads, the download goes to `<path>.part`
// and is only moved into place after the checksum matches, other *.gguf files
// in the directory are deleted afterwards. Failures exit 1 with
// "CommandError: ..." on stderr, so the `&&` in the worker command stops there.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { aiModelPath } from './model_service.js';

export const AI_MODEL_URL_DEFAULT = 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';
export const AI_MODEL_SHA256_DEFAULT = '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db';
const TIMEOUT_MS = 60_000; // requests.get(..., timeout=60): connect and per-read timeout, not a total limit

export class CommandError extends Error {}

const modelUrl = () => process.env.AI_MODEL_URL ?? AI_MODEL_URL_DEFAULT;
const expectedSha = () => process.env.AI_MODEL_SHA256 ?? AI_MODEL_SHA256_DEFAULT;

async function sha256Matches(path: string): Promise<boolean> {
  const expected = expectedSha();
  if (!expected) return true;
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: 8 * 1024 * 1024 })) digest.update(chunk as Buffer);
  return digest.digest('hex') === expected;
}

function deleteOldModels(modelPath: string, out: (s: string) => void): void {
  const dir = dirname(modelPath);
  for (const name of readdirSync(dir)) {
    const old = join(dir, name);
    if (name.endsWith('.gguf') && name !== '.gguf' && name !== basename(modelPath)) {
      rmSync(old);
      out(`Deleted old model: ${old}`);
    }
  }
}

async function download(url: string, dest: string): Promise<void> {
  const ctl = new AbortController();
  let timer = setTimeout(() => ctl.abort(new Error(`Read timed out. (read timeout=${TIMEOUT_MS / 1000})`)), TIMEOUT_MS);
  const bump = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(new Error(`Read timed out. (read timeout=${TIMEOUT_MS / 1000})`)), TIMEOUT_MS); };
  try {
    const resp = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    if (!resp.ok) {
      const kind = resp.status < 500 ? 'Client' : 'Server';
      throw new Error(`${resp.status} ${kind} Error: ${resp.statusText} for url: ${resp.url || url}`);
    }
    if (!resp.body) throw new Error('empty response body');
    const body = Readable.fromWeb(resp.body as import('node:stream/web').ReadableStream);
    body.on('data', bump);
    await pipeline(body, createWriteStream(dest));
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadAiModel(opts: { force?: boolean; out?: (s: string) => void } = {}): Promise<void> {
  const out = opts.out ?? ((s: string) => process.stdout.write(`${s}\n`));
  const modelPath = aiModelPath();
  mkdirSync(dirname(modelPath), { recursive: true });

  if (existsSync(modelPath) && !opts.force) {
    if (await sha256Matches(modelPath)) {
      out(`Model already present and verified at ${modelPath}`);
      deleteOldModels(modelPath, out);
      return;
    }
    out(`Existing file at ${modelPath} failed checksum — re-downloading`);
  }

  const url = modelUrl();
  out(`Downloading ${url} -> ${modelPath} ...`);
  const tmpPath = `${modelPath}.part`;
  try {
    await download(url, tmpPath);
  } catch (exc) {
    if (existsSync(tmpPath)) rmSync(tmpPath);
    const e = exc as Error & { cause?: Error };
    throw new CommandError(`Download failed: ${e.cause?.message ?? e.message ?? e}`);
  }

  if (!(await sha256Matches(tmpPath))) {
    rmSync(tmpPath);
    throw new CommandError('Downloaded file failed sha256 verification against AI_MODEL_SHA256 — deleted, not installed.');
  }

  renameSync(tmpPath, modelPath);
  out(`Model downloaded and verified at ${modelPath}`);
  deleteOldModels(modelPath, out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  downloadAiModel({ force: process.argv.includes('--force') }).then(
    () => process.exit(0),
    (exc) => {
      process.stderr.write(exc instanceof CommandError ? `CommandError: ${exc.message}\n` : `${(exc as Error)?.stack ?? exc}\n`);
      process.exit(1);
    },
  );
}
