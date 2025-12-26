from django.db import models


class Calendar(models.Model):
    property = models.OneToOneField("properties.Property", on_delete=models.CASCADE, related_name="calendar")
    sync_url = models.URLField(blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
