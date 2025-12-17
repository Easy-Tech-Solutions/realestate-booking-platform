from django.db import models


class PropertyMedia(models.Model):
    image = models.ImageField(upload_to="properties/")
    caption = models.CharField(max_length=255, blank=True)

    def __str__(self) -> str:  # pragma: no cover
        return self.caption or self.image.name
