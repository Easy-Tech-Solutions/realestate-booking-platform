from django.urls import path
from .views import metrics_health

urlpatterns = [
    path("health/", metrics_health, name="analytics-health"),
]
