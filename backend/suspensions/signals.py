"""
Suspension signals.

post_save on Suspension
  - new record  → send "account suspended" notification to user
  - status → revoked → send "account reinstated" notification

We use pre_save to stash the old status so post_save can detect the transition,
matching the same pattern used in the notifications app.
"""

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver


@receiver(pre_save, sender='suspensions.Suspension')
def suspension_pre_save(sender, instance, **kwargs):
    if instance.pk:
        try:
            instance._pre_save_status = sender.objects.get(pk=instance.pk).status
        except sender.DoesNotExist:
            instance._pre_save_status = None
    else:
        instance._pre_save_status = None


@receiver(post_save, sender='suspensions.Suspension')
def suspension_post_save(sender, instance, created, **kwargs):
    from notifications.services import notify_account_suspended, notify_account_reinstated

    if created:
        try:
            notify_account_suspended(instance)
            sender.objects.filter(pk=instance.pk).update(user_notified=True)
        except Exception:
            pass
        return

    old_status = getattr(instance, '_pre_save_status', None)
    if old_status != instance.status and instance.status == 'revoked':
        try:
            notify_account_reinstated(instance)
        except Exception:
            pass
