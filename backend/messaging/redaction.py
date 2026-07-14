"""
Strip phone numbers and email addresses out of chat messages.

We do this at the *send* boundary (HTTP view + WebSocket consumer) so the
redacted form is what gets persisted — there's no original to leak later.

Why redact instead of block?
---------------------------
Silent rejection feels surveillant and pushes users to find workarounds.
Replacing the contact details with a visible marker preserves the rest of
the message, signals to both parties that the platform is paying attention,
and gives us a clean signal we can surface to the sender as a one-time
educational nudge.

Detection strategy
------------------
A previous version of this file used a strict regex that required digits
in 3-3-4 groups (``088 123 4567``). Users routed around it by inserting
extra zeros (``008123456``), shifting the separator position
(``0880-012-421``), or breaking the digit run with whitespace
(``08800 0000``). Trying to enumerate every layout in one regex is a
losing arms race.

Instead we do two passes:

1. **Liberal candidate match.** Find any run of 8+ characters that's
   digits + common phone separators (space, dash, dot, parens, plus).
   This is intentionally permissive so it catches future obfuscation
   variants we haven't seen yet.
2. **Digit-only validation.** Strip every non-digit from the candidate
   and check whether the result is 8–13 digits — the window that covers
   every Liberian mobile encoding (``88XXXXXXX`` through
   ``+23188XXXXXXX``) plus the common obfuscations (extra leading zeros,
   doubled trunk-zero).

False positives are kept at bay by a short list of explicit exceptions
(ISO dates) and by the 8-digit floor (booking IDs, prices, room counts,
and other in-domain numbers are shorter).
"""

import re

# Phone candidate: starts with `+` or a digit, contains 8+ chars of digits
# and common separators, ends with a digit. Anchored against non-alphanum
# context so we don't slice into longer alphanumeric IDs.
_PHONE_CANDIDATE_RE = re.compile(
    r'''
    (?<![A-Za-z0-9])           # not part of a word/digit run before
    \+?\d                      # starts with optional + then a digit
    [\d\s().\-]{6,}            # 6+ more chars of digits or phone separators
    \d                         # ends with a digit
    (?![A-Za-z0-9])            # not part of a longer run after
    ''',
    re.VERBOSE,
)

# Exception: ISO 8601 calendar dates (YYYY-MM-DD or YYYY-M-D). After
# stripping separators a date strips to 8 digits, which would otherwise
# pass the phone validator. Property/booking dates appear in chat fairly
# often so this exception is worth carrying.
_ISO_DATE_RE = re.compile(r'^\d{4}-\d{1,2}-\d{1,2}$')

# Standard email — RFC-pragmatic, not RFC-perfect. Good enough to catch the
# 99% case (gmail / yahoo / company addresses) without false-positiving on
# things like "see issue #123@release" because we require a dotted TLD.
_EMAIL_RE = re.compile(
    r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}',
)

REDACTION_MARKER = '[contact info removed]'

# 8 to 13 digits, after stripping separators, covers every Liberian mobile
# variant we want to catch — bare `88XXXXXXX` through `+23188XXXXXXX`,
# including obfuscations with one or two extra leading zeros.
_MIN_PHONE_DIGITS = 8
_MAX_PHONE_DIGITS = 13


def _looks_like_phone(candidate: str) -> bool:
    stripped = candidate.strip()
    if _ISO_DATE_RE.match(stripped):
        return False
    digits = re.sub(r'\D', '', stripped)
    return _MIN_PHONE_DIGITS <= len(digits) <= _MAX_PHONE_DIGITS


# ---------------------------------------------------------------------------
# Restricted phrases (Business Policy §11.2) — attempts to move the deal or
# the conversation off-platform. These aren't redacted (the phrase itself
# isn't PII, and cutting it out mid-sentence reads as broken/suspicious) —
# they're only flagged for the anti-bypass violation/escalation pipeline in
# messaging.violations.
# ---------------------------------------------------------------------------
_RESTRICTED_PHRASES = [
    (re.compile(r'\bsend\s+me\s+your\s+(contact|number|phone|email|whatsapp)\b', re.I), 'send_me_your_contact'),
    (re.compile(r"\blet'?s\s+talk\s+outside\b", re.I), 'lets_talk_outside'),
    (re.compile(r'\bcall\s+me\s+directly\b', re.I), 'call_me_directly'),
    (re.compile(r'\btext\s+me\s+(at|on)\b', re.I), 'text_me_at'),
    (re.compile(r'\b(whatsapp|telegram|signal|imo)\s+me\b', re.I), 'messaging_app_handoff'),
    (re.compile(r'\badd\s+me\s+on\s+(whatsapp|telegram|signal)\b', re.I), 'add_me_on_app'),
    (re.compile(r'\b(meet|talk|deal|pay)\s+(me\s+)?(directly\s+)?outside\s+(the\s+)?(platform|app|home\s*konn?e[ck]t)\b', re.I), 'outside_platform'),
    (re.compile(r'\boff[\s-]?platform\b', re.I), 'off_platform'),
    (re.compile(r'\bpay\s+me\s+(directly|in\s+cash)\b', re.I), 'pay_directly'),
    (re.compile(r'\bcash\s+payment\b', re.I), 'cash_payment'),
    (re.compile(r'\bwithout\s+(going\s+through\s+)?(the\s+)?app\b', re.I), 'without_the_app'),
]


def detect_restricted_phrases(text: str) -> list[str]:
    """Returns the list of matched phrase codes (empty if none)."""
    if not text:
        return []
    return [code for pattern, code in _RESTRICTED_PHRASES if pattern.search(text)]


def scan_message(text: str) -> tuple[str, list[str]]:
    """Return ``(redacted_text, violations)``.

    ``violations`` is a list of violation codes — ``'phone_number'``,
    ``'email'``, and/or ``'restricted_phrase:<code>'`` — empty if the
    message was clean. Phone numbers and emails are replaced with
    REDACTION_MARKER in the returned text; restricted phrases are left
    in place (see module docstring) and only reported via `violations`.
    """
    if not text:
        return text, []

    violations: list[str] = []

    def _replace_phone(match: re.Match) -> str:
        if _looks_like_phone(match.group(0)):
            violations.append('phone_number')
            return REDACTION_MARKER
        return match.group(0)

    redacted = _PHONE_CANDIDATE_RE.sub(_replace_phone, text)

    def _replace_email(match: re.Match) -> str:
        violations.append('email')
        return REDACTION_MARKER

    redacted = _EMAIL_RE.sub(_replace_email, redacted)

    for code in detect_restricted_phrases(text):
        violations.append(f'restricted_phrase:{code}')

    return redacted, violations
