"""
Prompt construction + JSON-constrained inference for the three admin review
flows. Text-only: these functions score the structured fields submitted
alongside a review (names, addresses, detector evidence strings, listing
copy), not the uploaded ID/MOU/inspection images or listing photos — there is
no vision model or OCR step in this pipeline.
"""
import json
import logging
import re

from .model_service import get_model

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are a risk-review assistant for a real-estate booking platform. "
    "You are given structured text signals about one review item. Reply with "
    "ONLY a JSON object of the form "
    '{"score": <integer 0-100>, "rationale": "<one sentence>"}. '
    "score is how much human reviewer attention this item warrants: 0 means "
    "no concern, 100 means very high concern. Do not include any text outside "
    "the JSON object."
)


def _run_prompt(user_prompt: str, max_tokens: int = 200) -> dict:
    model = get_model()
    completion = model.create_chat_completion(
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        max_tokens=max_tokens,
    )
    raw = completion["choices"][0]["message"]["content"]
    return _parse_score_json(raw)


def _parse_score_json(raw: str) -> dict:
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        match = re.search(r'\{.*\}', raw or '', re.DOTALL)
        if not match:
            raise ValueError(f'Model did not return JSON: {raw!r}')
        data = json.loads(match.group(0))

    score = data.get('score')
    try:
        score = float(score)
    except (TypeError, ValueError):
        raise ValueError(f'Model returned a non-numeric score: {data!r}')
    score = max(0.0, min(100.0, score))
    rationale = str(data.get('rationale', '')).strip()[:500]
    return {'score': score, 'rationale': rationale}


def score_fraud_flag(flag) -> dict:
    prompt = (
        f'Flag type: {flag.get_flag_type_display()}\n'
        f'Severity assigned by the rule-based detector: {flag.get_severity_display()}\n'
        f'Evidence: {flag.details}'
    )
    return _run_prompt(prompt)


def score_listing_flag(flag) -> dict:
    listing = flag.listing
    listing_summary = 'No linked listing.'
    if listing is not None:
        listing_summary = (
            f'Title: {listing.title}\n'
            f'Description: {listing.description[:1000]}\n'
            f'Price: {listing.price} ({listing.property_type} in {listing.city}, {listing.country})\n'
            f'Amenities: {", ".join(listing.amenities or [])}\n'
            f'Highlights: {", ".join(listing.highlights or [])}'
        )
    prompt = (
        f'Flag type: {flag.get_flag_type_display()}\n'
        f'Severity assigned by the rule-based detector: {flag.get_severity_display()}\n'
        f'Detector evidence: {flag.details}\n\n'
        f'Listing content:\n{listing_summary}'
    )
    return _run_prompt(prompt)


def score_host_application(application) -> dict:
    prompt = (
        'Host/agent application submitted for review. Assess plausibility and '
        'internal consistency of the submitted text only (no document image '
        'was analyzed).\n'
        f'Full name: {application.full_name}\n'
        f'Address: {application.address}\n'
        f'Phone: {application.phone}'
    )
    return _run_prompt(prompt)


def score_property_verification(verification) -> dict:
    prompt = (
        'Property ownership verification submitted for review. Assess '
        'plausibility and internal consistency of the submitted text only '
        '(no MOU/inspection document image was analyzed).\n'
        f'Ownership type: {verification.get_ownership_type_display()}\n'
        f'Owner name: {verification.owner_name}\n'
        f'Property location: {verification.property_location}\n'
        f'Deed/volume number: {verification.deed_volume_number}'
    )
    return _run_prompt(prompt)
