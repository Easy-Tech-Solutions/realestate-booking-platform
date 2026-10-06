// The inference runtime behind aiscoring.model_service.get_model(): Django runs
// `llama_cpp.Llama(model_path, n_ctx=AI_MODEL_CONTEXT_SIZE, n_threads=cpu-1,
// verbose=False).create_chat_completion(...)` (llama-cpp-python 0.3.x); this is
// the same thing over node-llama-cpp (same llama.cpp engine, same GGUF file).
//
// What is reproduced from llama-cpp-python's code path, not node-llama-cpp's
// own chat machinery (LlamaChatSession uses its own chat wrappers/stop logic):
//  - prompt: the GGUF's own `tokenizer.chat_template`, rendered with Jinja
//    (llama_chat_format.Jinja2ChatFormatter: trim/lstrip blocks,
//    add_generation_prompt=True, eos_token/bos_token from the vocab), tokenized
//    with special tokens parsed and no BOS added (added_special=True);
//  - sampling: create_chat_completion defaults top_p=0.95, top_k=40,
//    min_p=0.05, repeat_penalty=1.0 (off), the caller's temperature/max_tokens,
//    and llama-cpp-python's effective per-call seed (seed=None →
//    random.Random(LLAMA_DEFAULT_SEED).randint(0, 2**32) = 872737089, the same
//    value on every call);
//  - response_format={"type": "json_object"} → llama_grammar.JSON_GBNF;
//  - stopping: end-of-generation token, stop=[eos_token text] (+ caller stops,
//    text cut before the first match), max_tokens (None/<=0 → rest of the
//    context; truncated to n_ctx - prompt_tokens); prompt >= n_ctx raises
//    ValueError "Requested tokens (N) exceed context window of N";
//  - the response dict shape (chat.completion with usage), text detokenized
//    without special tokens.
// Exact generated text can still differ from Django's: different llama.cpp
// build, sampler chain implementation and thread split (llama-cpp-python uses
// cpu_count threads for prompt batches, cpu-1 for generation; here cpu-1 for both).

import { randomUUID } from 'node:crypto';
import type { ChatCompletion, ChatCompletionOptions, ChatModel } from './model_service.js';

/** llama_cpp.llama_grammar.JSON_GBNF (verbatim). */
export const JSON_GBNF = String.raw`
root   ::= object
value  ::= object | array | string | number | ("true" | "false" | "null") ws

object ::=
  "{" ws (
            string ":" ws value
    ("," ws string ":" ws value)*
  )? "}" ws

array  ::=
  "[" ws (
            value
    ("," ws value)*
  )? "]" ws

string ::=
  "\"" (
    [^"\\\x7F\x00-\x1F] |
    "\\" (["\\bfnrt] | "u" [0-9a-fA-F]{4}) # escapes
  )* "\"" ws

number ::= ("-"? ([0-9] | [1-9] [0-9]{0,15})) ("." [0-9]+)? ([eE] [-+]? [0-9] [1-9]{0,15})? ws

# Optional space: by convention, applied in this grammar after literal chars when allowed
ws ::= | " " | "\n" [ \t]{0,20}
`;

/** random.Random(llama_cpp.LLAMA_DEFAULT_SEED).randint(0, 2**32) — llama-cpp-python's seed when none is given. */
export const LLAMA_CPP_PYTHON_EFFECTIVE_SEED = 872737089;

// create_chat_completion() defaults (llama_cpp/llama.py).
const DEFAULTS = { temperature: 0.2, top_p: 0.95, top_k: 40, min_p: 0.05 };

export async function loadLlamaCppModel(opts: { modelPath: string; contextSize: number; threads: number }): Promise<ChatModel> {
  const { getLlama, LlamaGrammar, LlamaGrammarEvaluationState, LlamaLogLevel } = await import('node-llama-cpp');
  const { Template } = await import('@huggingface/jinja');

  // verbose=False, CPU only (n_gpu_layers=0), never compile llama.cpp at runtime.
  const llama = await getLlama({ gpu: false, build: 'never', logLevel: LlamaLogLevel.error, progressLogs: false });
  const model = await llama.loadModel({ modelPath: opts.modelPath, gpuLayers: 0, useMmap: true });
  const context = await model.createContext({
    contextSize: opts.contextSize, batchSize: 512, threads: opts.threads, sequences: 1, flashAttention: false,
  });
  const sequence = context.getSequence();
  const nCtx = context.contextSize;

  const meta = (model.fileInfo.metadata as unknown as { tokenizer?: { chat_template?: string } }).tokenizer;
  const chatTemplate = meta?.chat_template;
  if (!chatTemplate) throw new Error(`${opts.modelPath} has no tokenizer.chat_template (llama-cpp-python would fall back to the llama-2 format; not ported)`);
  const template = new Template(chatTemplate);
  const eosToken = model.tokens.eosString ?? '';
  const bosToken = model.tokens.bosString ?? '';
  const jsonGrammar = new LlamaGrammar(llama, { grammar: JSON_GBNF });

  // One sequence, one generation at a time (the ai_scoring worker is solo/concurrency-1 anyway;
  // this also serialises the startup warmup against a first task).
  let busy: Promise<unknown> = Promise.resolve();

  async function complete(o: ChatCompletionOptions): Promise<ChatCompletion> {
    // (@huggingface/jinja predefines raise_exception and strftime_now, as Jinja2ChatFormatter passes them)
    const prompt = template.render({ messages: o.messages, eos_token: eosToken, bos_token: bosToken, add_generation_prompt: true });
    const promptTokens = model.tokenize(prompt, true);
    if (promptTokens.length >= nCtx) throw new Error(`Requested tokens (${promptTokens.length}) exceed context window of ${nCtx}`);
    let maxTokens = o.max_tokens ?? 0;
    if (maxTokens <= 0) maxTokens = nCtx - promptTokens.length;
    if (maxTokens + promptTokens.length >= nCtx) maxTokens = nCtx - promptTokens.length;

    const stop = [...(o.stop == null ? [] : typeof o.stop === 'string' ? [o.stop] : o.stop), eosToken].filter((s) => s !== '');
    const grammarEvaluationState = o.response_format && (o.response_format as { type?: string }).type === 'json_object'
      ? new LlamaGrammarEvaluationState({ model, grammar: jsonGrammar }) : undefined;

    // Reuse the KV cache for the longest common prompt prefix (llama-cpp-python does the same), always
    // re-evaluating at least the last prompt token so there are fresh logits to sample from.
    const keep = Math.min(sequence.compareContextTokens(promptTokens).firstDifferentIndex, promptTokens.length - 1);
    if (keep < sequence.nextTokenIndex) await sequence.eraseContextTokenRanges([{ start: keep, end: sequence.nextTokenIndex }]);

    const completionTokens: typeof promptTokens = [];
    let text: string | null = null;  // set when a stop string cut the text
    let finishReason: 'stop' | 'length' = 'length';
    const gen = sequence.evaluate(promptTokens.slice(keep), {
      temperature: o.temperature ?? DEFAULTS.temperature, topP: o.top_p ?? DEFAULTS.top_p, topK: o.top_k ?? DEFAULTS.top_k,
      minP: o.min_p ?? DEFAULTS.min_p, seed: o.seed ?? LLAMA_CPP_PYTHON_EFFECTIVE_SEED, // repeat_penalty=1.0 → no repeatPenalty
      grammarEvaluationState, yieldEogToken: true,
    });
    try {
      for await (const token of gen) {
        if (model.isEogToken(token)) { finishReason = 'stop'; break; }
        completionTokens.push(token);
        const all = model.detokenize(completionTokens, false, promptTokens);
        const hit = stop.find((s) => all.includes(s));
        if (hit !== undefined) { text = all.slice(0, all.indexOf(hit)); finishReason = 'stop'; break; }
        if (completionTokens.length >= maxTokens) { finishReason = 'length'; break; }
      }
    } finally {
      await gen.return(undefined);
    }
    text ??= model.detokenize(completionTokens, false, promptTokens);
    const id = `chatcmpl-${randomUUID()}`;
    return {
      id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: o.model ?? opts.modelPath,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, logprobs: null, finish_reason: finishReason }],
      usage: { prompt_tokens: promptTokens.length, completion_tokens: completionTokens.length, total_tokens: promptTokens.length + completionTokens.length },
    };
  }

  return {
    createChatCompletion(o) {
      const run = busy.then(() => complete(o), () => complete(o));
      busy = run.catch(() => undefined);
      return run;
    },
  };
}
