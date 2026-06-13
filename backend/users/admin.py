from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils import timezone
from django.contrib import messages
from .models import User, Profile


class ProfileInline(admin.StackedInline):
    model = Profile
    can_delete = False
    verbose_name_plural = 'Profile'


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ['username', 'email', 'role', 'is_active', 'is_archived', 'email_verified', 'scheduled_deletion_at']
    list_filter = ['role', 'is_staff', 'is_superuser', 'is_active', 'is_archived', 'email_verified']
    search_fields = ['username', 'email', 'first_name', 'last_name']
    ordering = ['username']
    actions = ['reactivate_archived_accounts']

    @admin.action(description='Reactivate archived accounts (within 30-day window)')
    def reactivate_archived_accounts(self, request, queryset):
        reactivated = 0
        skipped = 0
        for user in queryset.filter(is_archived=True):
            if user.scheduled_deletion_at and user.scheduled_deletion_at > timezone.now():
                user.is_active = True
                user.is_archived = False
                user.archived_at = None
                user.scheduled_deletion_at = None
                user.save(update_fields=['is_active', 'is_archived', 'archived_at', 'scheduled_deletion_at'])
                reactivated += 1
            else:
                skipped += 1
        if reactivated:
            self.message_user(request, f'{reactivated} account(s) reactivated.', messages.SUCCESS)
        if skipped:
            self.message_user(
                request,
                f'{skipped} account(s) skipped — 30-day window has passed or account is not archived.',
                messages.WARNING,
            )

    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('Personal info', {'fields': ('first_name', 'last_name', 'email')}),
        ('Permissions', {
            'fields': ('role', 'is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions'),
        }),
        ('Email Verification', {
            'fields': ('email_verified', 'email_verification_token'),
        }),
        ('Account Deletion', {
            'fields': ('is_archived', 'archived_at', 'scheduled_deletion_at'),
            'classes': ('collapse',),
            'description': 'Archived accounts are deactivated and will be permanently deleted after the scheduled date.',
        }),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
    )

    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'email', 'password1', 'password2', 'role'),
        }),
    )

    inlines = [ProfileInline]


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'bio']
    search_fields = ['user__username', 'bio']
    readonly_fields = ['user']
