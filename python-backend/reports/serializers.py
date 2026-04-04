from rest_framework import serializers
from .models import Report


class ReportCreateSerializer(serializers.ModelSerializer):
    """
    Used by authenticated users to file a new report.

    Exactly one of reported_user / reported_listing / reported_review /
    reported_message must be supplied, matching the declared content_type.
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
        ]

    def validate(self, attrs):
        content_type = attrs.get('content_type')

        # Map each content_type to its expected FK field
        expected_field = {
            Report.ContentType.USER:    'reported_user',
            Report.ContentType.LISTING: 'reported_listing',
            Report.ContentType.REVIEW:  'reported_review',
            Report.ContentType.MESSAGE: 'reported_message',
        }

        required = expected_field.get(content_type)
        if not required:
            raise serializers.ValidationError({'content_type': 'Invalid content type.'})

        # The expected FK must be present
        if not attrs.get(required):
            raise serializers.ValidationError(
                {required: f'This field is required when content_type is "{content_type}".'}
            )

        # All other FK fields must be absent
        for field, fk_field in expected_field.items():
            if fk_field != required and attrs.get(fk_field):
                raise serializers.ValidationError(
                    {fk_field: f'Do not supply this field when content_type is "{content_type}".'}
                )

        return attrs

    def validate_reported_user(self, value):
        request = self.context.get('request')
        if request and value and value == request.user:
            raise serializers.ValidationError('You cannot report yourself.')
        return value


class ReportSerializer(serializers.ModelSerializer):
    """
    Read serializer — returned to the reporter or an admin.
    Exposes human-readable labels alongside raw choice values.
    """
    reporter_username     = serializers.CharField(source='reporter.username', read_only=True)
    reported_user_name    = serializers.SerializerMethodField()
    reported_listing_title = serializers.SerializerMethodField()
    status_display        = serializers.CharField(source='get_status_display', read_only=True)
    report_type_display   = serializers.CharField(source='get_report_type_display', read_only=True)
    content_type_display  = serializers.CharField(source='get_content_type_display', read_only=True)
    resolved_by_username  = serializers.SerializerMethodField()

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
