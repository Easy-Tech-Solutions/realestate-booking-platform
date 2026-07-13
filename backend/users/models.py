from django.db import models
from django.contrib.auth.models import AbstractUser
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone


class User(AbstractUser):
    ROLE_CHOICES = [
        ('user', 'Regular User'),
        ('agent', 'Agent'),
        ('admin', 'Admin'),
        ('superadmin', 'Superadmin'),
    ]
    email_verified = models.BooleanField(default=False)
    email_verification_token = models.CharField(max_length=200, blank=True, null=True)
    email_verification_token_expires_at = models.DateTimeField(null=True, blank=True)
    password_reset_token = models.CharField(max_length=200, blank=True, null=True)
    password_reset_token_expires_at = models.DateTimeField(null=True, blank=True)
    role = models.CharField(max_length=15, choices=ROLE_CHOICES, default='user')
    is_archived = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
    scheduled_deletion_at = models.DateTimeField(null=True, blank=True)

    # Soft-delete marker. When set, the account is considered closed: the user
    # cannot log in, their listings are unpublished, and their public-facing
    # name is replaced with "Deleted User". Historical bookings, payments and
    # reviews keep their FK to this row so financial / audit history stays
    # intact.
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        constraints = [
            # Case-insensitive, since every lookup in this codebase (login,
            # password reset, Google sign-up dedup) already matches on
            # email__iexact. A plain unique=True wouldn't catch "Foo@x.com"
            # vs "foo@x.com" as the same address. Blank emails are excluded
            # since a handful of legacy/incomplete accounts have none.
            models.UniqueConstraint(Lower('email'), name='unique_lower_email', condition=~Q(email='')),
        ]

    def save(self, *args, **kwargs):
        # A superuser, or anyone with the app-level 'superadmin' role, is
        # always a full admin: staff + superuser, bypassing every permission
        # check (see rbac.permissions.is_full_admin). This is the top tier —
        # unrestricted, not governed by the RBAC engine.
        #
        # 'admin' is a lesser, second tier: still staff (dashboard access),
        # but NOT superuser — their actual abilities come entirely from the
        # RBAC engine's "Admin" preset role (broad, but excludes rbac_engine
        # and infrastructure.break_glass so an admin can't self-escalate).
        #
        # NOTE: is_staff is deliberately NOT a trigger here on its own. That
        # lets us create limited-privilege staff (e.g. the Product Support /
        # Compliance / Supervisor officers) as is_staff=True, is_superuser=False,
        # role='user' — they reach the admin panel but only get the abilities
        # granted by their RBAC role, instead of bypassing every permission
        # check. Officers also keep role='user' so they get no host/admin
        # powers on the React frontend (which keys off role only).
        if self.is_superuser or self.role == 'superadmin':
            self.role = 'superadmin'
            self.is_staff = True
            self.is_superuser = True
        elif self.role == 'admin':
            self.is_staff = True

        if self.email:
            self.email = self.email.strip().lower()

        super().save(*args, **kwargs)

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    image = models.ImageField(upload_to='uploads/', null=True, blank=True)
    bio = models.TextField(blank=True)
    is_superhost = models.BooleanField(default=False)
    last_seen = models.DateTimeField(null=True, blank=True)
    momo_number = models.CharField(
        max_length=20, blank=True,
        help_text='MTN Mobile Money number for receiving payouts (Liberian format, e.g. 0880123456)'
    )

    def __str__(self):
        return f'{self.user.username} Profile'


class PhoneChangeRequest(models.Model):
    """
    Tracks a pending phone number change through the 2-step verification flow:
      Step 1 — (optional password re-entry for accounts with a usable password)
               → both email and SMS OTPs are generated and sent at once.
      Step 2 — User submits both OTPs together; on success the phone is updated.

    One active request per user at a time (OneToOneField).  The row is deleted
    after the change is committed or if the user cancels. The *_verified flags
    are retained for schema compatibility but are no longer used as
    intermediate gates.
    """
    NETWORK_MTN    = 'mtn'
    NETWORK_ORANGE = 'orange'
    NETWORK_CHOICES = [
        (NETWORK_MTN,    'MTN Mobile Money'),
        (NETWORK_ORANGE, 'Orange Money'),
    ]

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='phone_change_request',
    )
    new_phone_number = models.CharField(max_length=20)
    network_provider = models.CharField(
        max_length=10,
        choices=NETWORK_CHOICES,
        help_text='Which wallet this number belongs to',
    )

    # Step 1
    password_verified = models.BooleanField(default=False)

    # Step 2 — email OTP
    email_otp         = models.CharField(max_length=6)
    email_otp_expiry  = models.DateTimeField()
    email_otp_verified = models.BooleanField(default=False)

    # Step 3 — SMS OTP sent to the new number
    sms_otp           = models.CharField(max_length=6, blank=True)
    sms_otp_expiry    = models.DateTimeField(null=True, blank=True)
    sms_otp_verified  = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    def is_email_otp_expired(self):
        return timezone.now() > self.email_otp_expiry

    def is_sms_otp_expired(self):
        return self.sms_otp_expiry is None or timezone.now() > self.sms_otp_expiry

    def __str__(self):
        return f'{self.user.username} → {self.new_phone_number} ({self.get_network_provider_display()})'
