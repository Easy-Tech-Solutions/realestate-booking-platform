from django.urls import path
from . import views

urlpatterns = [
    path('initiate/', views.initiate_payment, name='initiate_payment'),
    path('verify/', views.verify_payment, name='verify_payment'),
    path('refund/', views.process_refund, name='process_refund'),
    path('user/', views.user_payments, name='user_payments'),
    path('<uuid:payment_id>/', views.payment_detail, name='payment_detail'),
    path('webhooks/mtn_momo/', views.mtn_momo_webhook, name='mtn_momo_webhook'),
]