"""
Per-model registrations for the generic admin CRUD system. Adding a new
model here (plus a matching RBAC resource in rbac/resources.py) is the whole
backend side of exposing it in the custom admin dashboard.
"""
from listings.models import PropertyCategory
from payments.models import Currency
from testimonials.models import Testimonial
from newsletter.models import Subscriber

from .registry import ModelConfig, register

register('property_category', ModelConfig(
    model=PropertyCategory, resource='listings.categories', audit_label='property_category',
    fields=['id', 'name', 'slug', 'is_active', 'sort_order'],
    search_fields=['name', 'slug'], filterable_fields=['is_active'],
    ordering_fields=['sort_order', 'name', 'id'], default_ordering='sort_order',
))

register('currency', ModelConfig(
    model=Currency, resource='finances.currencies', audit_label='currency',
    fields=['id', 'code', 'name', 'symbol', 'exchange_rate_to_usd', 'is_active'],
    search_fields=['code', 'name'], filterable_fields=['is_active'],
    ordering_fields=['code', 'exchange_rate_to_usd'], default_ordering='code',
))

register('testimonial', ModelConfig(
    model=Testimonial, resource='marketing.testimonials', audit_label='testimonial',
    # `user` (nullable FK) is deliberately excluded — it's a read-derived
    # attribution field (see TestimonialSerializer.user_avatar), never
    # something the admin dashboard should set/change.
    fields=['id', 'name', 'location', 'rating', 'quote', 'avatar_color', 'is_active', 'created_at'],
    read_only_fields=['id', 'created_at'],
    search_fields=['name', 'location', 'quote'], filterable_fields=['is_active', 'rating'],
    ordering_fields=['created_at', 'rating'], default_ordering='-created_at',
))

register('subscriber', ModelConfig(
    model=Subscriber, resource='marketing.newsletter', audit_label='subscriber',
    fields=['id', 'email', 'interests', 'is_active', 'subscribed_at', 'unsubscribe_token'],
    read_only_fields=['id', 'subscribed_at', 'unsubscribe_token'],
    search_fields=['email'], filterable_fields=['is_active'],
    ordering_fields=['subscribed_at', 'email'], default_ordering='-subscribed_at',
    # Reviewed: `unsubscribe_token` is a read-only public link identifier
    # (used in unsubscribe emails), not a credential — safe to expose.
    allow_sensitive_field_names=True,
))
