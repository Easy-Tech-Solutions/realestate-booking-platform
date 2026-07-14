import uuid

from django.contrib.auth import get_user_model
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from platformops.utils import is_feature_enabled

User = get_user_model()

FALLBACK_REPLY = (
    "I'm sorry, I'm not able to answer that right now. "
    "Would you like me to connect you with a support agent?"
)


def _get_or_create_session(request, session_id: str | None):
    from .models import ChatSession
    user = request.user if request.user.is_authenticated else None

    if session_id:
        try:
            session = ChatSession.objects.get(id=session_id)
            if user and not session.user:
                session.user = user
                session.save(update_fields=['user'])
            return session
        except ChatSession.DoesNotExist:
            pass

    return ChatSession.objects.create(user=user, session_key=str(uuid.uuid4()))


# ---------------------------------------------------------------------------
# POST /api/chatbot/chat/
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([AllowAny])
def chat(request):
    """
    Enqueues a reply task and returns immediately with a task_id.
    The client polls GET /api/chatbot/status/<task_id>/ until state == SUCCESS.

    Body:  { "message": "...", "session_id": "<uuid|null>" }
    Returns: { "task_id": "...", "session_id": "<uuid>" }
    """
    message = str(request.data.get('message', '')).strip()
    if not message:
        return Response({'error': 'message is required.'}, status=status.HTTP_400_BAD_REQUEST)
    if len(message) > 2000:
        return Response({'error': 'message too long (max 2000 chars).'}, status=status.HTTP_400_BAD_REQUEST)

    session_id = request.data.get('session_id') or None
    session = _get_or_create_session(request, session_id)

    if session.handed_off:
        return Response({
            'task_id': None,
            'session_id': str(session.id),
            'status': 'HANDED_OFF',
            'reply': (
                'You are already connected with a support agent. '
                'Please continue the conversation in your Messages or Tickets.'
            ),
            'needs_agent': False,
        })

    from .tasks import get_chatbot_reply_task

    if is_feature_enabled('ai_scoring_enabled', default=False):
        task = get_chatbot_reply_task.apply_async(args=[str(session.id), message])
        return Response({'task_id': task.id, 'session_id': str(session.id)})
    else:
        # AI off — persist messages inline and return immediately (no queue)
        from .models import ChatMessage
        ChatMessage.objects.create(session=session, role='user', content=message)
        bot_msg = ChatMessage.objects.create(
            session=session, role='bot',
            content=FALLBACK_REPLY, suggested_handoff=True,
        )
        return Response({
            'task_id': None,
            'session_id': str(session.id),
            'status': 'SUCCESS',
            'reply': FALLBACK_REPLY,
            'needs_agent': True,
        })


# ---------------------------------------------------------------------------
# GET /api/chatbot/status/<task_id>/
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([AllowAny])
def chat_status(request, task_id):
    """
    Poll for the result of a previously enqueued chat task.
    Returns:
      { "status": "PENDING"|"SUCCESS"|"FAILURE",
        "reply": str|null, "needs_agent": bool|null }
    """
    from celery.result import AsyncResult
    result = AsyncResult(task_id)

    if result.state == 'SUCCESS':
        data = result.result or {}
        return Response({
            'status': 'SUCCESS',
            'reply': data.get('reply', FALLBACK_REPLY),
            'needs_agent': data.get('needs_agent', False),
        })

    if result.state == 'FAILURE':
        return Response({
            'status': 'SUCCESS',  # surface as a reply, not an HTTP error
            'reply': FALLBACK_REPLY,
            'needs_agent': True,
        })

    # PENDING / STARTED / RETRY
    return Response({'status': 'PENDING', 'reply': None, 'needs_agent': None})


# ---------------------------------------------------------------------------
# POST /api/chatbot/handoff/
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([AllowAny])
def handoff(request):
    """
    Creates a SupportTicket pre-populated with the chat transcript.
    Guest name/email are optional — if omitted the ticket is filed as "Guest"
    and the agent can follow up for contact details.

    Body: { "session_id": "<uuid>", "summary"?: "...", "name"?: "...", "email"?: "..." }
    Returns: { "ticket_number": "HK-...", "ticket_id": int, "conversation_id": int|null }
    """
    session_id = str(request.data.get('session_id', '')).strip()
    if not session_id:
        return Response({'error': 'session_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

    from .models import ChatSession, ChatMessage
    try:
        session = ChatSession.objects.prefetch_related('messages').get(id=session_id)
    except ChatSession.DoesNotExist:
        return Response({'error': 'Session not found.'}, status=status.HTTP_404_NOT_FOUND)

    # Idempotent — return existing ticket if already handed off
    if session.handed_off and session.handoff_ticket_id:
        ticket = session.handoff_ticket
        return Response({
            'ticket_number': ticket.ticket_number,
            'ticket_id': ticket.id,
            'conversation_id': ticket.conversation_id,
        })

    # Build transcript
    messages = list(session.messages.order_by('created_at'))
    transcript_lines = [
        f"[{'User' if m.role == ChatMessage.ROLE_USER else 'Bot'}]: {m.content}"
        for m in messages
    ]
    transcript = '\n'.join(transcript_lines) or '(no messages)'

    user_summary = str(request.data.get('summary', '')).strip()
    description = (f'{user_summary}\n\n' if user_summary else '') + f'--- Chat transcript ---\n{transcript}'

    first_user = next((m for m in messages if m.role == ChatMessage.ROLE_USER), None)
    subject = (first_user.content[:100] if first_user else 'Chatbot handoff') or 'Chatbot handoff'

    from support.models import SupportTicket, TicketMessage
    from support.sla import sla_deadline_for

    user = request.user if request.user.is_authenticated else None
    # Guest details are optional — file without them if not provided
    guest_name = str(request.data.get('name', '')).strip()[:100] or 'Guest'
    guest_email = str(request.data.get('email', '')).strip()[:254]

    ticket = SupportTicket.objects.create(
        user=user,
        guest_name=guest_name if not user else '',
        guest_email=guest_email if not user else '',
        category='other',
        subject=subject,
        description=description,
        priority='medium',
    )
    ticket.sla_due_at = sla_deadline_for(ticket.priority, ticket.created_at)
    ticket.save(update_fields=['sla_due_at'])

    sender_name = ''
    if user:
        sender_name = f'{user.first_name} {user.last_name}'.strip() or user.username
    else:
        sender_name = guest_name

    TicketMessage.objects.create(
        ticket=ticket, sender=user, sender_name=sender_name,
        is_staff_reply=False, content=description,
    )

    conversation_id = None
    if user:
        try:
            from support.views import _create_support_conversation
            conv = _create_support_conversation(user, subject, description)
            if conv:
                ticket.conversation = conv
                ticket.save(update_fields=['conversation'])
                conversation_id = conv.id
        except Exception:
            pass

    session.handed_off = True
    session.handoff_ticket = ticket
    session.save(update_fields=['handed_off', 'handoff_ticket', 'updated_at'])

    return Response({
        'ticket_number': ticket.ticket_number,
        'ticket_id': ticket.id,
        'conversation_id': conversation_id,
    }, status=status.HTTP_201_CREATED)
