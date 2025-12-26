from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.accounts.models.user import User
from apps.accounts.models.profile import Profile


@receiver(post_save, sender=User)
def create_profile(sender, instance: User, created: bool, **kwargs):
    if created:
        Profile.objects.create(user=instance)
