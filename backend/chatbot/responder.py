"""
Prompt construction and inference for the chatbot.

Reuses the same Qwen2.5-3B-Instruct GGUF model loaded by aiscoring.model_service
(singleton — loaded once per Celery worker process).

The model is instructed to:
  - Answer questions about the platform and available listings.
  - Reply with a JSON object so we can reliably detect the handoff signal.
  - Set "needs_agent": true when it cannot answer, triggering the handoff UI.
"""
import json
import logging
import re

from aiscoring.model_service import get_model

logger = logging.getLogger(__name__)

# Reserve tokens for: system prompt + knowledge (~900) + reply (512) + safety margin (100)
# Leaves ~536 tokens for conversation history inside a 2048-token context window.
_HISTORY_TOKEN_BUDGET = 500
# Rough chars-per-token estimate for English/mixed text (conservative)
_CHARS_PER_TOKEN = 3.5

_SYSTEM_PROMPT = """\
You are a helpful customer support chatbot for HomeKonet, a real-estate booking
platform in Liberia. Use ONLY the knowledge provided below to answer the user's
question. Do not make up information that is not in the knowledge base.

If the user asks about something you cannot answer from the provided knowledge,
or if they explicitly ask to speak to a human agent, set "needs_agent" to true.

Always reply with ONLY a JSON object in this exact format:
{{"reply": "<your answer>", "needs_agent": false}}

Keep replies concise and friendly. Do not include any text outside the JSON.

--- KNOWLEDGE BASE ---
{knowledge}
--- END KNOWLEDGE BASE ---
"""


def _trim_history(history: list[dict]) -> list[dict]:
    """
    Keep as many recent turns as fit within _HISTORY_TOKEN_BUDGET, always
    preserving the most recent turns (newest-first selection, then reversed).
    """
    budget_chars = int(_HISTORY_TOKEN_BUDGET * _CHARS_PER_TOKEN)
    selected = []
    used = 0
    for turn in reversed(history):
        cost = len(turn['content']) + 10  # +10 for role/overhead
        if used + cost > budget_chars:
            break
        selected.append(turn)
        used += cost
    return list(reversed(selected))


def _build_messages(knowledge: str, history: list[dict], user_message: str) -> list[dict]:
    system = _SYSTEM_PROMPT.format(knowledge=knowledge)
    messages = [{'role': 'system', 'content': system}]
    for turn in _trim_history(history):
        role = 'user' if turn['role'] == 'user' else 'assistant'
        messages.append({'role': role, 'content': turn['content']})
    messages.append({'role': 'user', 'content': user_message})
    return messages


def _parse_response(raw: str) -> dict:
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        match = re.search(r'\{.*\}', raw or '', re.DOTALL)
        if not match:
            return {'reply': raw.strip() or 'Sorry, I could not process that.', 'needs_agent': False}
        try:
            data = json.loads(match.group(0))
        except (ValueError, TypeError):
            return {'reply': raw.strip(), 'needs_agent': False}

    reply = str(data.get('reply', '')).strip() or 'Sorry, I could not process that.'
    needs_agent = bool(data.get('needs_agent', False))
    return {'reply': reply, 'needs_agent': needs_agent}


def get_chatbot_reply(knowledge: str, history: list[dict], user_message: str) -> dict:
    """
    Returns {'reply': str, 'needs_agent': bool}.
    Raises aiscoring.model_service.ModelUnavailable if the GGUF file is missing.
    """
    model = get_model()
    messages = _build_messages(knowledge, history, user_message)
    completion = model.create_chat_completion(
        messages=messages,
        response_format={'type': 'json_object'},
        temperature=0.3,
        max_tokens=512,
    )
    raw = completion['choices'][0]['message']['content']
    return _parse_response(raw)
