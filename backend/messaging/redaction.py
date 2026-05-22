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
"""

import re

# Liberian mobile numbers — only mobile carriers (MTN: 088, Orange/Lonestar:
# 077). Both 9-digit local form (088xxxxxxx, with optional leading 0 written
# differently in different copy/paste flows) and international (+231 88xxxxxxx
# or 23188xxxxxxx). Separators (space, dash, dot) allowed between groups.
_PHONE_RE = re.compile(
    r'''
    (?<!\d)                   # not part of a longer digit run
    (?:\+?231[\s.\-]?)?       # optional +231 country code
    0?                        # optional trunk 0
    (?:88|77)                 # MTN or Orange/Lonestar prefix
    [\s.\-]?
    \d{3}
    [\s.\-]?
    \d{4}
    (?!\d)
    ''',
    re.VERBOSE,
)

# Standard email — RFC-pragmatic, not RFC-perfect. Good enough to catch the
# 99% case (gmail / yahoo / company addresses) without false-positiving on
# things like "see issue #123@release" because we require a dotted TLD.
_EMAIL_RE = re.compile(
    r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}',
)

REDACTION_MARKER = '[contact info removed]'


def redact_contact_info(text: str) -> tuple[str, bool]:
    """Return ``(redacted_text, was_redacted)``.

    ``was_redacted`` is True if any phone number or email was replaced, so
    the caller can surface a warning to the sender.
    """
    if not text:
        return text, False

    redacted = _PHONE_RE.sub(REDACTION_MARKER, text)
    redacted = _EMAIL_RE.sub(REDACTION_MARKER, redacted)
    return redacted, redacted != text
