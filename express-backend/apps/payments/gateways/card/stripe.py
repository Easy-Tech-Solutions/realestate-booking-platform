import stripe
from django.conf import settings


def init_stripe():
    stripe.api_key = settings.STRIPE_SECRET_KEY


def create_payment_intent(amount_cents: int, currency: str = "usd") -> dict:
    init_stripe()
    intent = stripe.PaymentIntent.create(amount=amount_cents, currency=currency)
    return intent
