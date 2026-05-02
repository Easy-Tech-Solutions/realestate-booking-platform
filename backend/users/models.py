from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils import timezone


class User(AbstractUser):
    ROLE_CHOICES = [
        ('user', 'Regular User'),
        ('agent', 'Agent'),
        ('admin', 'Admin')
    ]
    email_verified = models.BooleanField(default=False)
    email_verification_token = models.CharField(max_length=100, blank=True, null=True)
    password_reset_token = models.CharField(max_length=100, blank=True, null=True)
    role = models.CharField(max_length=15, choices=ROLE_CHOICES, default='user')

    def save(self, *args, **kwargs):
        # Keep Django admin flags and app role aligned.
        if self.is_superuser or self.is_staff or self.role == 'admin':
            self.role = 'admin'
            self.is_staff = True
            self.is_superuser = True
        else:
            self.is_staff = False
            self.is_superuser = False

        super().save(*args, **kwargs)

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    image = models.ImageField(upload_to='uploads/', null=True, blank=True)
    bio = models.TextField(blank=True)
    is_superhost = models.BooleanField(default=False)
    momo_number = models.CharField(
        max_length=20, blank=True,
        help_text='MTN Mobile Money number for receiving payouts (Liberian format, e.g. 0880123456)'
    )

    def __str__(self):
        return f'{self.user.username} Profile'


class PhoneChangeRequest(models.Model):
    """
    Tracks a pending phone number change through the 3-step verification flow:
      Step 1 — Password re-entry    (password_verified = True)
      Step 2 — Email OTP            (email_otp_verified = True  → SMS sent to new number)
      Step 3 — SMS OTP on new number (sms_otp_verified = True   → phone updated)

    One active request per user at a time (OneToOneField).  The row is deleted
    after the change is committed or if the user cancels.
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
