from django.core.mail import send_mail
from django.conf import settings
from django.utils import timezone
from django.core.paginator import Paginator
from django.db import models
from django.db.models import Q
from django.contrib.auth import get_user_model

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import ContactInquiry, SupportTicket, TicketMessage, TicketAttachment

User = get_user_model()


def _get_support_admin():
    """Return the first staff/admin user to act as the support participant, or None."""
    return User.objects.filter(
        models.Q(role='admin') | models.Q(is_staff=True)
    ).order_by('id').first()


def _create_support_conversation(user, subject, opening_message):
    """
    Create a messaging Conversation between `user` and the support admin,
    with `opening_message` as the first message.
    Returns the Conversation or None if no admin user exists.
    """
    try:
        from messaging.models import Conversation, Message
        admin = _get_support_admin()
        if admin is None or admin == user:
            return None

        conv = Conversation.objects.create()
        conv.participants.add(user, admin)

        Message.objects.create(
            conversation=conv,
            sender=user,
            content=opening_message,
            message_type='text',
        )
        return conv
    except Exception:
        return None
from .serializers import (
    ContactInquirySerializer,
    ContactInquiryCreateSerializer,
    SupportTicketListSerializer,
    SupportTicketDetailSerializer,
    SupportTicketCreateSerializer,
    SupportTicketAdminUpdateSerializer,
    TicketMessageSerializer,
    TicketMessageCreateSerializer,
    TicketAttachmentSerializer,
)

SUPPORT_EMAIL = 'support@homekonet.com'


def _is_admin(user):
    return user.is_authenticated and (getattr(user, 'role', None) == 'admin' or user.is_staff)


def _send_support_email(subject, body, fail_silently=True):
    try:
        send_mail(
            subject=subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[SUPPORT_EMAIL],
            fail_silently=fail_silently,
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Contact
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([AllowAny])
def contact_create(request):
    """Public endpoint — save a ContactInquiry and notify support."""
    serializer = ContactInquiryCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    auth_user = request.user if request.user.is_authenticated else None
    inquiry = serializer.save(user=auth_user)

    email_body = (
        f'New Contact Inquiry\n'
        f'-------------------\n'
        f'From: {inquiry.name} <{inquiry.email}>\n'
        f'Category: {inquiry.get_category_display()}\n'
        f'Subject: {inquiry.subject}\n\n'
        f'{inquiry.message}\n'
    )
    _send_support_email(
        subject=f'[Contact] {inquiry.subject}',
        body=email_body,
    )

    conversation_id = None
    if auth_user:
        opening = (
            f'[Contact Inquiry] {inquiry.subject}\n\n'
            f'Category: {inquiry.get_category_display()}\n\n'
            f'{inquiry.message}'
        )
        conv = _create_support_conversation(auth_user, inquiry.subject, opening)
        if conv:
            inquiry.conversation = conv
            inquiry.save(update_fields=['conversation'])
            conversation_id = conv.id

    return Response(
        {
            'message': 'Your inquiry has been received. We will get back to you shortly.',
            'id': inquiry.id,
            'conversation_id': conversation_id,
        },
        status=status.HTTP_201_CREATED,
    )


# ---------------------------------------------------------------------------
# Tickets (user-facing)
# ---------------------------------------------------------------------------

@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def ticket_list_create(request):
    """
    GET  — list authenticated user's tickets (admin sees all). Supports ?status= filter.
    POST — create a new ticket. Authenticated users are linked via FK; guests use
           guest_name/guest_email. Accepts multipart for file attachments.
    """
    if request.method == 'GET':
        if not request.user.is_authenticated:
            return Response(
                {'error': 'Authentication required to list tickets.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if _is_admin(request.user):
            qs = SupportTicket.objects.all()
        else:
            qs = SupportTicket.objects.filter(user=request.user)

        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        serializer = SupportTicketListSerializer(
            qs, many=True, context={'request': request}
        )
        return Response(serializer.data)

    # POST
    serializer = SupportTicketCreateSerializer(
        data=request.data, context={'request': request}
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data
    user = request.user if request.user.is_authenticated else None

    ticket = SupportTicket.objects.create(
        user=user,
        guest_name=d.get('guest_name', '') if not user else '',
        guest_email=d.get('guest_email', '') if not user else '',
        category=d['category'],
        subject=d['subject'],
        description=d['description'],
    )

    # First message mirrors the description
    sender_name = ''
    if user:
        sender_name = f'{user.first_name} {user.last_name}'.strip() or user.username
    else:
        sender_name = d.get('guest_name', 'Guest')

    TicketMessage.objects.create(
        ticket=ticket,
        sender=user,
        sender_name=sender_name,
        is_staff_reply=False,
        content=d['description'],
    )

    # Handle file attachments
    for uploaded_file in request.FILES.getlist('attachments'):
        TicketAttachment.objects.create(
            ticket=ticket,
            file=uploaded_file,
            filename=uploaded_file.name,
            file_size=uploaded_file.size,
            content_type=uploaded_file.content_type or '',
            uploaded_by=user,
        )

    # Create a messaging conversation for authenticated users
    if user:
        opening = (
            f'[{ticket.ticket_number}] {ticket.subject}\n\n'
            f'Category: {ticket.get_category_display()}\n\n'
            f'{ticket.description}'
        )
        conv = _create_support_conversation(user, ticket.subject, opening)
        if conv:
            ticket.conversation = conv
            ticket.save(update_fields=['conversation'])

    # Notify support
    requester = ticket.requester_name
    requester_email = ticket.requester_email
    email_body = (
        f'New Support Ticket: {ticket.ticket_number}\n'
        f'----------------------------------------------\n'
        f'From: {requester} <{requester_email}>\n'
        f'Category: {ticket.get_category_display()}\n'
        f'Subject: {ticket.subject}\n'
        f'Priority: {ticket.get_priority_display()}\n\n'
        f'{ticket.description}\n'
    )
    _send_support_email(
        subject=f'[Ticket {ticket.ticket_number}] {ticket.subject}',
        body=email_body,
    )

    return Response(
        SupportTicketDetailSerializer(ticket, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([AllowAny])
def ticket_detail(request, pk):
    """Ticket detail — must be owner or admin."""
    try:
        ticket = SupportTicket.objects.get(pk=pk)
    except SupportTicket.DoesNotExist:
        return Response({'error': 'Ticket not found.'}, status=status.HTTP_404_NOT_FOUND)

    user = request.user
    is_owner = user.is_authenticated and ticket.user == user
    if not is_owner and not _is_admin(user):
        return Response({'error': 'Access denied.'}, status=status.HTTP_403_FORBIDDEN)

    serializer = SupportTicketDetailSerializer(ticket, context={'request': request})
    return Response(serializer.data)


@api_view(['POST'])
@permission_classes([AllowAny])
def ticket_add_message(request, pk):
    """Add a message to a ticket. Owner or admin only."""
    try:
        ticket = SupportTicket.objects.get(pk=pk)
    except SupportTicket.DoesNotExist:
        return Response({'error': 'Ticket not found.'}, status=status.HTTP_404_NOT_FOUND)

    user = request.user
    is_owner = user.is_authenticated and ticket.user == user
    is_admin_user = _is_admin(user)

    if not is_owner and not is_admin_user:
        return Response({'error': 'Access denied.'}, status=status.HTTP_403_FORBIDDEN)

    serializer = TicketMessageCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    if user.is_authenticated:
        sender_name = f'{user.first_name} {user.last_name}'.strip() or user.username
        sender = user
    else:
        sender_name = ticket.guest_name or 'Guest'
        sender = None

    message = TicketMessage.objects.create(
        ticket=ticket,
        sender=sender,
        sender_name=sender_name,
        is_staff_reply=is_admin_user,
        content=serializer.validated_data['content'],
    )

    # If admin replied, move ticket to in_progress if still open
    if is_admin_user and ticket.status == 'open':
        ticket.status = 'in_progress'
        ticket.save(update_fields=['status', 'updated_at'])
    # If user replied while pending, reopen to in_progress
    elif is_owner and ticket.status == 'pending_user':
        ticket.status = 'in_progress'
        ticket.save(update_fields=['status', 'updated_at'])

    return Response(
        TicketMessageSerializer(message, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([AllowAny])
def ticket_search(request):
    """
    Public. Search resolved tickets by subject/description (case-insensitive).
    Returns top 5 matches: [{id, ticket_number, subject, category, resolved_at}]
    """
    query = request.query_params.get('q', '').strip()
    if not query:
        return Response([])

    qs = SupportTicket.objects.filter(
        status='resolved',
    ).filter(
        Q(subject__icontains=query) | Q(description__icontains=query)
    )[:5]

    results = [
        {
            'id': t.id,
            'ticket_number': t.ticket_number,
            'subject': t.subject,
            'category': t.category,
            'resolved_at': t.resolved_at,
        }
        for t in qs
    ]
    return Response(results)


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_ticket_list(request):
    """
    Admin only. List all tickets with filters: ?status=, ?category=, ?priority=, ?assigned_to=
    Returns paginated results (page_size=20).
    """
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    qs = SupportTicket.objects.select_related('user', 'assigned_to').all()

    status_filter = request.query_params.get('status')
    if status_filter:
        qs = qs.filter(status=status_filter)

    category_filter = request.query_params.get('category')
    if category_filter:
        qs = qs.filter(category=category_filter)

    priority_filter = request.query_params.get('priority')
    if priority_filter:
        qs = qs.filter(priority=priority_filter)

    assigned_to_filter = request.query_params.get('assigned_to')
    if assigned_to_filter:
        if assigned_to_filter == 'unassigned':
            qs = qs.filter(assigned_to__isnull=True)
        else:
            try:
                qs = qs.filter(assigned_to_id=int(assigned_to_filter))
            except (ValueError, TypeError):
                pass

    page_number = request.query_params.get('page', 1)
    page_size = int(request.query_params.get('page_size', 20))
    paginator = Paginator(qs, page_size)

    try:
        page = paginator.page(page_number)
    except Exception:
        page = paginator.page(1)

    serializer = SupportTicketListSerializer(
        page.object_list, many=True, context={'request': request}
    )
    return Response({
        'count': paginator.count,
        'num_pages': paginator.num_pages,
        'current_page': page.number,
        'results': serializer.data,
    })


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def admin_ticket_update(request, pk):
    """Admin only. Update status, priority, assigned_to on a ticket."""
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    try:
        ticket = SupportTicket.objects.get(pk=pk)
    except SupportTicket.DoesNotExist:
        return Response({'error': 'Ticket not found.'}, status=status.HTTP_404_NOT_FOUND)

    serializer = SupportTicketAdminUpdateSerializer(ticket, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # Handle resolved_at timestamp
    new_status = serializer.validated_data.get('status')
    if new_status == 'resolved' and ticket.status != 'resolved':
        ticket.resolved_at = timezone.now()
    elif new_status and new_status != 'resolved':
        ticket.resolved_at = None

    serializer.save()
    return Response(
        SupportTicketDetailSerializer(ticket, context={'request': request}).data
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_contact_list(request):
    """Admin only. List contact inquiries. Supports ?is_read=true/false filter."""
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    qs = ContactInquiry.objects.all()

    is_read_param = request.query_params.get('is_read')
    if is_read_param is not None:
        is_read_val = is_read_param.lower() in ('true', '1', 'yes')
        qs = qs.filter(is_read=is_read_val)

    serializer = ContactInquirySerializer(qs, many=True, context={'request': request})
    return Response(serializer.data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def admin_contact_update(request, pk):
    """Admin only. Update a contact inquiry (e.g. mark as read)."""
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    try:
        inquiry = ContactInquiry.objects.get(pk=pk)
    except ContactInquiry.DoesNotExist:
        return Response({'error': 'Contact inquiry not found.'}, status=status.HTTP_404_NOT_FOUND)

    serializer = ContactInquirySerializer(inquiry, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_stats(request):
    """Admin only. Return counts per ticket status plus unread contact inquiries."""
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    tickets = SupportTicket.objects.all()
    stats = {
        'open': tickets.filter(status='open').count(),
        'in_progress': tickets.filter(status='in_progress').count(),
        'pending_user': tickets.filter(status='pending_user').count(),
        'resolved': tickets.filter(status='resolved').count(),
        'closed': tickets.filter(status='closed').count(),
        'total': tickets.count(),
        'unread_contact': ContactInquiry.objects.filter(is_read=False).count(),
    }
    return Response(stats)
