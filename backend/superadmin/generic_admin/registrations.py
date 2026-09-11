"""
Per-model registrations for the generic admin CRUD system. Adding a new
model here (plus a matching RBAC resource in rbac/resources.py) is the whole
backend side of exposing it in the custom admin dashboard.
"""
from rest_framework import serializers

from listings.models import PropertyCategory, Listing
from payments.models import Currency
from testimonials.models import Testimonial
from newsletter.models import Subscriber

from .registry import ModelConfig, register


class PropertyCategoryGenericSerializer(serializers.ModelSerializer):
    """Adds `listings_count` (read-only) so an admin can see how many listings
    are tagged with a category before deleting/renaming it — `Listing.property_type`
    stores the category's slug as a plain string (no FK), so a slug rename or a
    delete never cascades automatically and silently orphans that reference."""

    listings_count = serializers.SerializerMethodField()

    class Meta:
        model = PropertyCategory
        fields = ['id', 'name', 'slug', 'is_active', 'sort_order', 'listings_count']
        read_only_fields = ['id', 'listings_count']

    def get_listings_count(self, obj):
        return Listing.objects.filter(property_type=obj.slug).count()

    def validate_slug(self, value):
        if self.instance is not None and value != self.instance.slug:
            count = Listing.objects.filter(property_type=self.instance.slug).count()
            force = str(self.initial_data.get('force', '')).lower() in ('true', '1', 'yes')
            if count and not force:
                raise serializers.ValidationError(
                    f'{count} listing(s) are tagged with the current slug "{self.instance.slug}" — '
                    'renaming it will orphan their category reference (they store the slug as plain '
                    'text, not a link to this category). Pass force=true to rename anyway.'
                )
        return value


register('property_category', ModelConfig(
    model=PropertyCategory, resource='listings.categories', audit_label='property_category',
    fields=['id', 'name', 'slug', 'is_active', 'sort_order', 'listings_count'],
    read_only_fields=['id', 'listings_count'],
    search_fields=['name', 'slug'], filterable_fields=['is_active'],
    ordering_fields=['sort_order', 'name', 'id'], default_ordering='sort_order',
    serializer_class=PropertyCategoryGenericSerializer,
))

register('currency', ModelConfig(
    model=Currency, resource='finances.currencies', audit_label='currency',
    fields=['id', 'code', 'name', 'symbol', 'exchange_rate_to_usd', 'is_active'],
    read_only_fields=['id', 'code'],
    search_fields=['code', 'name'], filterable_fields=['is_active'],
    ordering_fields=['code', 'exchange_rate_to_usd'], default_ordering='code',
    # Read-only: currency codes are hardcoded throughout the MTN MoMo gateway
    # (payments/gateways/mtn_momo.py) and PaymentService.convert_from_usd —
    # creating a bogus currency or deleting USD/LRD here would silently break
    # live payments. Rate/name/symbol/active editing is exposed instead via
    # payments/admin/currencies/ (PaymentsAdmin views, code immutable, no
    # create/delete) — see AdminFinance.tsx's CurrencyRatesSection.
    read_only=True,
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
