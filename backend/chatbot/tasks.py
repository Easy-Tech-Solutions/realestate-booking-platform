"""
Celery task for chatbot replies.

Runs on the existing `ai_scoring` queue (concurrency=1 / solo pool) so the
3 GB model is never loaded by more than one process at a time.
"""
import logging

from celery import shared_task
from aiscoring.model_service import ModelUnavailable

logger = logging.getLogger(__name__)

FALLBACK_REPLY = (
    "I'm sorry, I'm not able to answer that right now. "
    "Would you like me to connect you with a support agent?"
)


@shared_task(queue='ai_scoring')
def get_chatbot_reply_task(session_id: str, user_message: str) -> dict:
    """
    Loads history from DB, calls the model, persists the bot reply, and
    returns {'reply': str, 'needs_agent': bool, 'message_id': int}.
    """
    from .models import ChatSession, ChatMessage
    from .knowledge_base import build_knowledge_context
    from .responder import get_chatbot_reply

    try:
        session = ChatSession.objects.get(id=session_id)
    except ChatSession.DoesNotExist:
        return {'reply': FALLBACK_REPLY, 'needs_agent': True, 'message_id': None}

    # Persist the user message
    user_msg = ChatMessage.objects.create(
        session=session, role=ChatMessage.ROLE_USER, content=user_message
    )

    # Build conversation history (exclude the message we just saved so it
    # doesn't appear twice — it's passed separately as user_message)
    history = list(
        ChatMessage.objects
        .filter(session=session)
        .exclude(id=user_msg.id)
        .values('role', 'content')
        .order_by('created_at')
    )

    try:
        knowledge = build_knowledge_context()
        result = get_chatbot_reply(knowledge, history, user_message)
    except ModelUnavailable:
        result = {'reply': FALLBACK_REPLY, 'needs_agent': True}
    except Exception as exc:
        logger.exception('chatbot reply failed for session %s: %s', session_id, exc)
        result = {'reply': FALLBACK_REPLY, 'needs_agent': True}

    bot_msg = ChatMessage.objects.create(
        session=session,
        role=ChatMessage.ROLE_BOT,
        content=result['reply'],
        suggested_handoff=result['needs_agent'],
    )
    session.save(update_fields=['updated_at'])

    return {
        'reply': result['reply'],
        'needs_agent': result['needs_agent'],
        'message_id': bot_msg.id,
    }
