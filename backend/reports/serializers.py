from rest_framework import serializers
from .models import Report


class ReportCreateSerializer(serializers.ModelSerializer):
    """
    Used by authenticated users to file a new report.

    The FK fields (reported_user etc.) are all optional — the reporter
    can instead supply owner_name + screenshot when they don't know the ID.
    At least one of the FK fields OR owner_name must be present.
    """

    class Meta:
        model = Report
        fields = [
            'content_type',
            'reported_user',
            'reported_listing',
            'reported_review',
            'reported_message',
            'report_type',
            'description',
            'owner_name',
            'screenshot',
        ]
        extra_kwargs = {
            'reported_user':    {'required': False, 'allow_null': True},
            'reported_listing': {'required': False, 'allow_null': True},
            'reported_review':  {'required': False, 'allow_null': True},
            'reported_message': {'required': False, 'allow_null': True},
            'owner_name':       {'required': False},
            'screenshot':       {'required': False},
        }

    def validate(self, attrs):
        content_type = attrs.get('content_type')

        fk_map = {
            Report.ContentType.USER:    'reported_user',
            Report.ContentType.LISTING: 'reported_listing',
            Report.ContentType.REVIEW:  'reported_review',
            Report.ContentType.MESSAGE: 'reported_message',
        }

        required_fk = fk_map.get(content_type)
        if not required_fk:
            raise serializers.ValidationError({'content_type': 'Invalid content type.'})

        has_fk = bool(attrs.get(required_fk))
        has_context = bool(attrs.get('owner_name', '').strip() or attrs.get('screenshot'))

        if not has_fk and not has_context:
            raise serializers.ValidationError(
                'Please provide either the listing owner name / screenshot, '
                'or a direct reference to the reported content.'
            )

        # Clear unrelated FK fields
        for ct, fk_field in fk_map.items():
            if fk_field != required_fk:
                attrs.pop(fk_field, None)

        return attrs

    def validate_reported_user(self, value):
        request = self.context.get('request')
        if request and value and value == request.user:
            raise serializers.ValidationError('You cannot report yourself.')
        return value


class ReportSerializer(serializers.ModelSerializer):
    """
    Read serializer — returned to the reporter or an admin.
    """
    reporter_username      = serializers.CharField(source='reporter.username', read_only=True)
    reported_user_name     = serializers.SerializerMethodField()
    reported_listing_title = serializers.SerializerMethodField()
    status_display         = serializers.CharField(source='get_status_display', read_only=True)
    report_type_display    = serializers.CharField(source='get_report_type_display', read_only=True)
    content_type_display   = serializers.CharField(source='get_content_type_display', read_only=True)
    resolved_by_username   = serializers.SerializerMethodField()
    screenshot_url         = serializers.SerializerMethodField()

    class Meta:
        model = Report
        fields = [
            'id',
            'reporter_username',
            'content_type',
            'content_type_display',
            'reported_user',
            'reported_user_name',
            'reported_listing',
            'reported_listing_title',
            'reported_review',
            'reported_message',
            'report_type',
            'report_type_display',
            'description',
            'owner_name',
            'screenshot_url',
            'status',
            'status_display',
            'admin_notes',
            'resolved_by_username',
            'resolved_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields

    def get_reported_user_name(self, obj):
        if obj.reported_user:
            return obj.reported_user.get_full_name() or obj.reported_user.username
        return None

    def get_reported_listing_title(self, obj):
        if obj.reported_listing:
            return obj.reported_listing.title
        return None

    def get_resolved_by_username(self, obj):
        if obj.resolved_by:
            return obj.resolved_by.username
        return None

    def get_screenshot_url(self, obj):
        if not obj.screenshot:
            return None
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.screenshot.url)
        return obj.screenshot.url


class ReportAdminUpdateSerializer(serializers.ModelSerializer):
    """
    Used by admins to update a report's status and add internal notes.
    """

    class Meta:
        model = Report
        fields = ['status', 'admin_notes']

    def validate_status(self, value):
        allowed = [
            Report.Status.UNDER_REVIEW,
            Report.Status.RESOLVED,
            Report.Status.DISMISSED,
        ]
        if value not in allowed:
            raise serializers.ValidationError(
                f'Status must be one of: {", ".join(allowed)}.'
            )
        return value
