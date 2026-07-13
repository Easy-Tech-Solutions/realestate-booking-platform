from rest_framework import serializers
from .models import ContactInquiry, SupportTicket, TicketMessage, TicketAttachment, AirCoverClaim


class ContactInquirySerializer(serializers.ModelSerializer):
    class Meta:
        model = ContactInquiry
        fields = [
            'id', 'name', 'email', 'category', 'subject',
            'message', 'is_read', 'created_at',
        ]
        read_only_fields = ['id', 'is_read', 'created_at']


class ContactInquiryCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContactInquiry
        fields = ['name', 'email', 'category', 'subject', 'message']

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError('Name cannot be blank.')
        return value.strip()

    def validate_subject(self, value):
        if not value.strip():
            raise serializers.ValidationError('Subject cannot be blank.')
        return value.strip()

    def validate_message(self, value):
        if not value.strip():
            raise serializers.ValidationError('Message cannot be blank.')
        return value.strip()


class TicketAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = TicketAttachment
        fields = [
            'id', 'ticket', 'file', 'file_url', 'filename',
            'file_size', 'content_type', 'uploaded_by', 'created_at',
        ]
        read_only_fields = ['id', 'ticket', 'file_url', 'uploaded_by', 'created_at']

    def get_file_url(self, obj):
        request = self.context.get('request')
        if obj.file:
            try:
                url = obj.file.url
                if request is not None:
                    return request.build_absolute_uri(url)
                return url
            except Exception:
                return None
        return None


class TicketMessageSerializer(serializers.ModelSerializer):
    sender_display = serializers.SerializerMethodField()

    class Meta:
        model = TicketMessage
        fields = [
            'id', 'ticket', 'sender', 'sender_display', 'sender_name',
            'is_staff_reply', 'content', 'created_at',
        ]
        read_only_fields = [
            'id', 'ticket', 'sender', 'sender_display', 'is_staff_reply', 'created_at',
        ]

    def get_sender_display(self, obj):
        if obj.sender:
            name = f'{obj.sender.first_name} {obj.sender.last_name}'.strip()
            return name or obj.sender.username
        return obj.sender_name or 'Guest'


class TicketMessageCreateSerializer(serializers.Serializer):
    content = serializers.CharField(min_length=1)

    def validate_content(self, value):
        if not value.strip():
            raise serializers.ValidationError('Message content cannot be blank.')
        return value.strip()


class SupportTicketListSerializer(serializers.ModelSerializer):
    requester_name = serializers.CharField(read_only=True)
    requester_email = serializers.CharField(read_only=True)
    assigned_to_name = serializers.SerializerMethodField()
    message_count = serializers.SerializerMethodField()
    is_breached = serializers.SerializerMethodField()
    escalated_by_username = serializers.CharField(source='escalated_by.username', default=None, read_only=True)

    class Meta:
        model = SupportTicket
        fields = [
            'id', 'ticket_number', 'category', 'subject', 'status', 'priority',
            'requester_name', 'requester_email', 'assigned_to', 'assigned_to_name',
            'message_count', 'sla_due_at', 'is_breached',
            'escalated_at', 'escalated_by_username', 'escalation_notes',
            'resolved_at', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_assigned_to_name(self, obj):
        if obj.assigned_to:
            name = f'{obj.assigned_to.first_name} {obj.assigned_to.last_name}'.strip()
            return name or obj.assigned_to.username
        return None

    def get_message_count(self, obj):
        return obj.messages.count()

    def get_is_breached(self, obj):
        from django.utils import timezone
        return bool(obj.sla_due_at and obj.status not in ('resolved', 'closed') and obj.sla_due_at < timezone.now())


class SupportTicketDetailSerializer(serializers.ModelSerializer):
    requester_name = serializers.CharField(read_only=True)
    requester_email = serializers.CharField(read_only=True)
    assigned_to_name = serializers.SerializerMethodField()
    messages = TicketMessageSerializer(many=True, read_only=True)
    attachments = TicketAttachmentSerializer(many=True, read_only=True)
    conversation_id = serializers.SerializerMethodField()
    is_breached = serializers.SerializerMethodField()
    escalated_by_username = serializers.CharField(source='escalated_by.username', default=None, read_only=True)

    class Meta:
        model = SupportTicket
        fields = [
            'id', 'ticket_number', 'user', 'guest_name', 'guest_email',
            'category', 'subject', 'description', 'status', 'priority',
            'requester_name', 'requester_email',
            'assigned_to', 'assigned_to_name',
            'messages', 'attachments',
            'conversation_id',
            'sla_due_at', 'is_breached',
            'escalated_at', 'escalated_by_username', 'escalation_notes',
            'resolved_at', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'ticket_number', 'user', 'guest_name', 'guest_email',
            'requester_name', 'requester_email', 'assigned_to_name',
            'messages', 'attachments', 'conversation_id',
            'sla_due_at', 'is_breached', 'escalated_at', 'escalated_by_username', 'escalation_notes',
            'resolved_at', 'created_at', 'updated_at',
        ]

    def get_is_breached(self, obj):
        from django.utils import timezone
        return bool(obj.sla_due_at and obj.status not in ('resolved', 'closed') and obj.sla_due_at < timezone.now())

    def get_conversation_id(self, obj):
        if obj.conversation_id:
            return obj.conversation_id
        return None

    def get_assigned_to_name(self, obj):
        if obj.assigned_to:
            name = f'{obj.assigned_to.first_name} {obj.assigned_to.last_name}'.strip()
            return name or obj.assigned_to.username
        return None


class SupportTicketCreateSerializer(serializers.Serializer):
    category = serializers.ChoiceField(choices=[c[0] for c in SupportTicket.CATEGORY_CHOICES])
    subject = serializers.CharField(max_length=200)
    description = serializers.CharField(min_length=10)
    guest_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    guest_email = serializers.EmailField(required=False, allow_blank=True)

    def validate_subject(self, value):
        if not value.strip():
            raise serializers.ValidationError('Subject cannot be blank.')
        return value.strip()

    def validate_description(self, value):
        if not value.strip():
            raise serializers.ValidationError('Description cannot be blank.')
        return value.strip()

    def validate(self, attrs):
        # If no authenticated user, guest fields are required
        request = self.context.get('request')
        user = request.user if request else None
        if not (user and user.is_authenticated):
            if not attrs.get('guest_name', '').strip():
                raise serializers.ValidationError({'guest_name': 'Name is required for guest submissions.'})
            if not attrs.get('guest_email', '').strip():
                raise serializers.ValidationError({'guest_email': 'Email is required for guest submissions.'})
        return attrs


class SupportTicketAdminUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupportTicket
        fields = ['status', 'priority', 'assigned_to']

    def validate_status(self, value):
        valid = [c[0] for c in SupportTicket.STATUS_CHOICES]
        if value not in valid:
            raise serializers.ValidationError(f'Invalid status. Must be one of: {valid}')
        return value

    def validate_priority(self, value):
        valid = [c[0] for c in SupportTicket.PRIORITY_CHOICES]
        if value not in valid:
            raise serializers.ValidationError(f'Invalid priority. Must be one of: {valid}')
        return value


class AirCoverClaimSerializer(serializers.ModelSerializer):
    claimant_username = serializers.CharField(source='claimant.username', read_only=True)
    reviewed_by_username = serializers.CharField(source='reviewed_by.username', default=None, read_only=True)
    listing_title = serializers.CharField(source='booking.listing.title', read_only=True)
    claim_type_display = serializers.CharField(source='get_claim_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = AirCoverClaim
        fields = [
            'id', 'booking', 'listing_title', 'claimant', 'claimant_username',
            'claim_type', 'claim_type_display', 'description', 'requested_amount', 'approved_amount',
            'status', 'status_display', 'reviewed_by', 'reviewed_by_username', 'review_notes', 'reviewed_at',
            'created_at',
        ]
        read_only_fields = [
            'id', 'claimant', 'claimant_username', 'listing_title', 'claim_type_display',
            'approved_amount', 'status', 'status_display', 'reviewed_by', 'reviewed_by_username',
            'review_notes', 'reviewed_at', 'created_at',
        ]

    def validate_requested_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Requested amount must be greater than zero.')
        return value

    def validate_booking(self, booking):
        request = self.context.get('request')
        user = request.user if request else None
        if user and booking.customer_id != user.id and booking.listing.owner_id != user.id:
            raise serializers.ValidationError('You were not a party to this booking.')
        return booking
