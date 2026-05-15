from django.urls import path
from . import views

urlpatterns = [
    path('subscribe/',    views.subscribe,        name='newsletter-subscribe'),
    path('unsubscribe/',  views.unsubscribe,       name='newsletter-unsubscribe'),
    path('subscribers/',  views.subscriber_list,   name='newsletter-subscribers'),
]
