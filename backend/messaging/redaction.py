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


def redact_contact_info(text: str) -> tuple[str, bool]:
    """Return ``(redacted_text, was_redacted)``.

    ``was_redacted`` is True if any phone number or email was replaced, so
    the caller can surface a warning to the sender.
    """
    if not text:
        return text, False

    def _replace_phone(match: re.Match) -> str:
        return REDACTION_MARKER if _looks_like_phone(match.group(0)) else match.group(0)

    redacted = _PHONE_CANDIDATE_RE.sub(_replace_phone, text)
    redacted = _EMAIL_RE.sub(REDACTION_MARKER, redacted)
    return redacted, redacted != text
