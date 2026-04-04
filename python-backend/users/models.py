from django.db import models
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> origin/jake
from django.contrib.auth.models import AbstractUser

# Placeholder custom user-related models could go here later

class User(AbstractUser):
    ROLE_CHOICES = [
        ('user', 'Regular User'),
        ('agent', 'Agent'),
        ('admin', 'Admin')
    ]
    email_verified = models.BooleanField(default=False)
    email_verification_token = models.CharField(max_length=100, blank=True, null=True)
<<<<<<< HEAD
=======
    password_reset_token = models.CharField(max_length=100, blank=True, null=True)
>>>>>>> origin/jake
    role = models.CharField(max_length=15, choices=ROLE_CHOICES, default='user')
    
    def save(self, *args, **kwargs):
        #Automatically set staff/superstaff based on role
        if self.role == 'admin':
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
<<<<<<< HEAD

    def __str__(self):
        return f'{self.user.username} Profile'
=======

# Placeholder custom user-related models could go here later
>>>>>>> dalton
=======
    momo_number = models.CharField(
        max_length=20, blank=True,
        help_text='MTN Mobile Money number for receiving payouts (Liberian format, e.g. 0880123456)'
    )

    def __str__(self):
        return f'{self.user.username} Profile'
>>>>>>> origin/jake
