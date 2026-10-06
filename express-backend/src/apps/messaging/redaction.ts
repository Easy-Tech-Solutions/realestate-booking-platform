// messaging/redaction.py — strip phone numbers / emails, flag restricted phrases.
// Python `re` semantics on str patterns: \d / \s / \b are Unicode-aware.

import { PY_D, PY_WS, pyRegex, pyStrip } from './pyutil.js';

const PHONE_CANDIDATE_RE = new RegExp(
  `(?<![A-Za-z0-9])\\+?[${PY_D}][${PY_D}${PY_WS}().\\-]{6,}[${PY_D}](?![A-Za-z0-9])`, 'gu');
const ISO_DATE_RE = new RegExp(`^[${PY_D}]{4}-[${PY_D}]{1,2}-[${PY_D}]{1,2}\\n?$`, 'u');
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export const REDACTION_MARKER = '[contact info removed]';
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 13;

function looksLikePhone(candidate: string): boolean {
  const stripped = pyStrip(candidate);
  if (ISO_DATE_RE.test(stripped)) return false;
  const digits = Array.from(stripped.matchAll(/\p{Nd}/gu)).length;
  return digits >= MIN_PHONE_DIGITS && digits <= MAX_PHONE_DIGITS;
}

const RESTRICTED_PHRASES: [RegExp, string][] = [
  [pyRegex('\\bsend\\s+me\\s+your\\s+(contact|number|phone|email|whatsapp)\\b', 'i'), 'send_me_your_contact'],
  [pyRegex("\\blet'?s\\s+talk\\s+outside\\b", 'i'), 'lets_talk_outside'],
  [pyRegex('\\bcall\\s+me\\s+directly\\b', 'i'), 'call_me_directly'],
  [pyRegex('\\btext\\s+me\\s+(at|on)\\b', 'i'), 'text_me_at'],
  [pyRegex('\\b(whatsapp|telegram|signal|imo)\\s+me\\b', 'i'), 'messaging_app_handoff'],
  [pyRegex('\\badd\\s+me\\s+on\\s+(whatsapp|telegram|signal)\\b', 'i'), 'add_me_on_app'],
  [pyRegex('\\b(meet|talk|deal|pay)\\s+(me\\s+)?(directly\\s+)?outside\\s+(the\\s+)?(platform|app|home\\s*konn?e[ck]t)\\b', 'i'), 'outside_platform'],
  [pyRegex('\\boff[\\s-]?platform\\b', 'i'), 'off_platform'],
  [pyRegex('\\bpay\\s+me\\s+(directly|in\\s+cash)\\b', 'i'), 'pay_directly'],
  [pyRegex('\\bcash\\s+payment\\b', 'i'), 'cash_payment'],
  [pyRegex('\\bwithout\\s+(going\\s+through\\s+)?(the\\s+)?app\\b', 'i'), 'without_the_app'],
];

export function detectRestrictedPhrases(text: string): string[] {
  if (!text) return [];
  return RESTRICTED_PHRASES.filter(([re]) => re.test(text)).map(([, code]) => code);
}

/** scan_message(text) → [redacted_text, violation codes]. */
export function scanMessage(text: string): [string, string[]] {
  if (!text) return [text, []];
  const violations: string[] = [];
  let redacted = text.replace(PHONE_CANDIDATE_RE, (m) => {
    if (looksLikePhone(m)) {
      violations.push('phone_number');
      return REDACTION_MARKER;
    }
    return m;
  });
  redacted = redacted.replace(EMAIL_RE, () => {
    violations.push('email');
    return REDACTION_MARKER;
  });
  for (const code of detectRestrictedPhrases(text)) violations.push(`restricted_phrase:${code}`);
  return [redacted, violations];
}
