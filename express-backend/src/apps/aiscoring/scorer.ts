// aiscoring.scorer — prompt construction + JSON-constrained inference for the
// three admin review flows (text-only: structured fields, never the uploaded images).

import { pyRepr, pyStr } from '../../domain/notifications.js';
import { getModel } from './model_service.js';

type Row = Record<string, any>;

const SYSTEM_PROMPT =
  'You are a risk-review assistant for a real-estate booking platform. '
  + 'You are given structured text signals about one review item. Reply with '
  + 'ONLY a JSON object of the form '
  + '{"score": <integer 0-100>, "rationale": "<one sentence>"}. '
  + 'score is how much human reviewer attention this item warrants: 0 means '
  + 'no concern, 100 means very high concern. Do not include any text outside '
  + 'the JSON object.';

export interface ScoreResult { score: number; rationale: string }

/** get_FOO_display(): the choice label, or the raw value for an unknown choice. */
const display = (choices: Record<string, string>, v: string) => choices[v] ?? v;

export const FRAUD_FLAG_TYPES: Record<string, string> = {
  rapid_signup: 'Rapid account creation from one IP',
  shared_card: 'Same card used across multiple accounts',
  transaction_spike: 'Unusual transaction volume',
  manual: 'Manually flagged',
};
export const LISTING_FLAG_TYPES: Record<string, string> = {
  duplicate: 'Possible duplicate listing',
  price_anomaly: 'Price far outside normal range',
  manual: 'Manually flagged',
};
export const SEVERITIES: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export const OWNERSHIP_TYPES: Record<string, string> = { owner: 'Owner', non_owner: 'Non-Owner (MOU)', agent: 'Agent-Sourced' };

/** _run_prompt(user_prompt, max_tokens=200) */
export async function runPrompt(userPrompt: string, maxTokens = 200): Promise<ScoreResult> {
  const model = await getModel();
  const completion = await model.createChatCompletion({
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: maxTokens,
  });
  return parseScoreJson(completion.choices[0]!.message.content);
}

/** Python float(x) for a JSON value; null when float() would raise. */
function pyFloat(v: unknown): number | null {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/(\d)_(?=\d)/g, '$1');
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return Number(s);
  if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(s)) return NaN;
  return null;
}

/** Python min/max argument-order semantics (NaN never compares less/greater). */
const pyMin = (a: number, b: number) => (b < a ? b : a);
const pyMax = (a: number, b: number) => (b > a ? b : a);

/** _parse_score_json(raw) */
export function parseScoreJson(raw: string | null | undefined): ScoreResult {
  let data: unknown;
  try {
    if (typeof raw !== 'string') throw new TypeError('not a string');
    data = JSON.parse(raw);
  } catch {
    const m = /\{[\s\S]*\}/.exec(raw ?? '');
    if (!m) throw new Error(`Model did not return JSON: ${pyRepr(raw ?? null)}`);
    data = JSON.parse(m[0]);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError(`'${Array.isArray(data) ? 'list' : typeof data}' object has no attribute 'get'`);
  const d = data as Record<string, unknown>;
  const score = pyFloat(d.score ?? null);
  if (score === null) throw new Error(`Model returned a non-numeric score: ${pyRepr(d)}`);
  const clamped = pyMax(0.0, pyMin(100.0, score));
  const r = 'rationale' in d ? d.rationale : '';
  const rationale = [...pyStr(r).trim()].slice(0, 500).join('');
  return { score: clamped, rationale };
}

/** ", ".join(list) — TypeError for non-string items, like Python. */
function joinStrs(v: unknown): string {
  // `x or []`, then iterate: list items, str characters, dict keys; scalars aren't iterable.
  let items: unknown[];
  if (!v || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) items = [];
  else if (Array.isArray(v)) items = v;
  else if (typeof v === 'string') items = [...v];
  else if (typeof v === 'object') items = Object.keys(v);
  else throw new TypeError(`can only join an iterable`);
  items.forEach((x, i) => {
    if (typeof x !== 'string') throw new TypeError(`sequence item ${i}: expected str instance, ${typeof x === 'number' ? (Number.isInteger(x) ? 'int' : 'float') : x === null ? 'NoneType' : Array.isArray(x) ? 'list' : typeof x === 'boolean' ? 'bool' : 'dict'} found`);
  });
  return items.join(', ');
}

export async function scoreFraudFlag(flag: Row): Promise<ScoreResult> {
  const prompt =
    `Flag type: ${display(FRAUD_FLAG_TYPES, flag.flag_type)}\n`
    + `Severity assigned by the rule-based detector: ${display(SEVERITIES, flag.severity)}\n`
    + `Evidence: ${flag.details}`;
  return runPrompt(prompt);
}

/** `flag` carries the select_related listing as `flag.listing` (null when unlinked). */
export async function scoreListingFlag(flag: Row & { listing: Row | null }): Promise<ScoreResult> {
  const listing = flag.listing;
  let summary = 'No linked listing.';
  if (listing) {
    summary =
      `Title: ${listing.title}\n`
      + `Description: ${[...String(listing.description)].slice(0, 1000).join('')}\n`
      + `Price: ${listing.price} (${listing.property_type} in ${listing.city}, ${listing.country})\n`
      + `Amenities: ${joinStrs(listing.amenities)}\n`
      + `Highlights: ${joinStrs(listing.highlights)}`;
  }
  const prompt =
    `Flag type: ${display(LISTING_FLAG_TYPES, flag.flag_type)}\n`
    + `Severity assigned by the rule-based detector: ${display(SEVERITIES, flag.severity)}\n`
    + `Detector evidence: ${flag.details}\n\n`
    + `Listing content:\n${summary}`;
  return runPrompt(prompt);
}

/** Django bug reproduced: the prompt reads `application.phone`, which HostApplication doesn't have
 * (it has momo_number / next_of_kin_phone), so this raises AttributeError while building the
 * prompt — before the model is ever consulted — and the task always fails when the flag is on. */
export class PyAttributeError extends Error {}

export async function scoreHostApplication(application: Row): Promise<ScoreResult> {
  if (!('phone' in application)) throw new PyAttributeError("'HostApplication' object has no attribute 'phone'");
  const prompt =
    'Host/agent application submitted for review. Assess plausibility and '
    + 'internal consistency of the submitted text only (no document image '
    + 'was analyzed).\n'
    + `Full name: ${application.full_name}\n`
    + `Address: ${application.address}\n`
    + `Phone: ${application.phone}`;
  return runPrompt(prompt);
}

export async function scorePropertyVerification(v: Row): Promise<ScoreResult> {
  const prompt =
    'Property ownership verification submitted for review. Assess '
    + 'plausibility and internal consistency of the submitted text only '
    + '(no MOU/inspection document image was analyzed).\n'
    + `Ownership type: ${display(OWNERSHIP_TYPES, v.ownership_type)}\n`
    + `Owner name: ${v.owner_name}\n`
    + `Property location: ${v.property_location}\n`
    + `Deed/volume number: ${v.deed_volume_number}\n`
    + `Page number: ${v.page_number}`;
  return runPrompt(prompt);
}
