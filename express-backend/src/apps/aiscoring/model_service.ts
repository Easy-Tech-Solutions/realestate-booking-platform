// aiscoring.model_service — the local scoring model.
//
// Django loads a GGUF model (Qwen2.5 via llama-cpp-python) lazily, once per
// Celery worker process (the celery-ai worker). Same here: getModel() is only
// ever called from the ai_scoring queue's tasks (aiscoring + chatbot), and the
// default inference backend is node-llama-cpp (./llama_backend.ts), loaded
// lazily so the API process never touches the native runtime. A missing GGUF
// file raises ModelUnavailable with Django's own message; any other load
// failure propagates as a plain error, like Llama(...) raising in Django.
// setInferenceBackend(loader) swaps the runtime (tests, an HTTP llama.cpp server, ...).

import { existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { logger } from '../../lib/logger.js';

const log = logger.child({ logger: 'aiscoring.model_service' });

/** Raised when the GGUF file isn't on disk yet (not downloaded) or fails to load. */
export class ModelUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'ModelUnavailable'; }
}

export interface ChatMessage { role: string; content: string }
/** llama_cpp.Llama.create_chat_completion keyword arguments (the subset this codebase can pass). */
export interface ChatCompletionOptions {
  messages: ChatMessage[];
  response_format?: unknown;
  temperature?: number;
  max_tokens?: number | null;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  stop?: string | string[] | null;
  seed?: number | null;
  model?: string;
}
/** llama_types.CreateChatCompletionResponse */
export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: { index: number; message: { role: 'assistant'; content: string }; logprobs: null; finish_reason: 'stop' | 'length' }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
/** llama_cpp.Llama.create_chat_completion — the only call the scorers and the chatbot make. */
export interface ChatModel {
  createChatCompletion(opts: ChatCompletionOptions): Promise<Pick<ChatCompletion, 'choices'> & Partial<ChatCompletion>>;
}
export type InferenceLoader = (opts: { modelPath: string; contextSize: number; threads: number }) => ChatModel | Promise<ChatModel>;

/** settings.AI_MODEL_DIR / AI_MODEL_FILENAME / AI_MODEL_CONTEXT_SIZE (same env vars and defaults; BASE_DIR = /app). */
export function aiModelPath(): string {
  const dir = process.env.AI_MODEL_DIR ?? '/app/ai_models';
  return `${dir.replace(/\/+$/, '') || '/'}/${process.env.AI_MODEL_FILENAME ?? 'qwen2.5-0.5b-instruct-q4_k_m.gguf'}`;
}
const contextSize = () => Number.parseInt(process.env.AI_MODEL_CONTEXT_SIZE ?? '2048', 10);

/** Default runtime: node-llama-cpp, imported on first use only. */
const llamaCppLoader: InferenceLoader = async (opts) => (await import('./llama_backend.js')).loadLlamaCppModel(opts);

let loader: InferenceLoader = llamaCppLoader;
let model: ChatModel | null = null;
let loading: Promise<ChatModel> | null = null;

/** Swap the inference backend (null restores the default node-llama-cpp one). */
export function setInferenceBackend(fn: InferenceLoader | null): void {
  loader = fn ?? llamaCppLoader;
  model = null;
  loading = null;
}

/**
 * get_model(): lazy singleton. ModelUnavailable only when the file is missing (Django's check);
 * a load failure propagates as-is and the next call retries (Django leaves _model unset).
 */
export async function getModel(): Promise<ChatModel> {
  if (model) return model;
  const modelPath = aiModelPath();
  if (!existsSync(modelPath)) {
    throw new ModelUnavailable(`AI model file not found at ${modelPath} — run \`python manage.py download_ai_model\` first.`);
  }
  if (!loading) {
    log.info(`Loading local AI scoring model from ${modelPath}`);
    loading = Promise.resolve(loader({ modelPath, contextSize: contextSize(), threads: Math.max(1, (cpus().length || 4) - 1) }))
      .then((m) => { model = m; return m; })
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** warmup(): one minimal inference pass so the model is hot before the first task. Never throws. */
export async function warmup(): Promise<void> {
  try {
    const m = await getModel();
    await m.createChatCompletion({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, temperature: 0.0 });
    log.info('AI model warmup complete.');
  } catch (exc) {
    log.warn(`AI model warmup failed: ${(exc as Error)?.message ?? exc}`);
  }
}
