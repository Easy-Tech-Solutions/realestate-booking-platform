from django.urls import path
from .views import cms_health

urlpatterns = [
    path("health/", cms_health, name="cms-health"),
]
