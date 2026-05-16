from django.db import models
from django.conf import settings

AVATAR_COLORS = [
    'emerald', 'blue', 'orange', 'purple', 'rose', 'teal',
    'indigo', 'amber', 'cyan', 'lime',
]


class Testimonial(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='testimonials',
    )
    name = models.CharField(max_length=100)
    location = models.CharField(max_length=150, blank=True)
    rating = models.PositiveSmallIntegerField(default=5)
    quote = models.TextField()
    avatar_color = models.CharField(max_length=20, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.avatar_color:
            count = Testimonial.objects.count()
            self.avatar_color = AVATAR_COLORS[count % len(AVATAR_COLORS)]
        super().save(*args, **kwargs)

    @property
    def avatar_initials(self):
        parts = self.name.strip().split()
        if len(parts) >= 2:
            return (parts[0][0] + parts[-1][0]).upper()
        return self.name[:2].upper() if self.name else '??'

    def __str__(self):
        return f'{self.name} ({self.rating}★)'
