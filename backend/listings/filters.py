from django_filters import rest_framework as filters
from django.db.models import Q
from .models import Listing

class ListingFilter(filters.FilterSet):
    min_price = filters.NumberFilter(field_name='price', lookup_expr='gte')
    max_price = filters.NumberFilter(field_name='price', lookup_expr='lte')
    min_bedrooms = filters.NumberFilter(field_name='bedrooms', lookup_expr='gte')
    max_bedrooms = filters.NumberFilter(field_name='bedrooms', lookup_expr='lte')
    min_square_footage = filters.NumberFilter(field_name='square_footage', lookup_expr='gte')
    max_square_footage = filters.NumberFilter(field_name='square_footage', lookup_expr='lte')
    owner_id = filters.NumberFilter(field_name='owner__id', lookup_expr='exact')
    property_type_exact = filters.CharFilter(field_name='property_type', lookup_expr='exact')
    is_available = filters.BooleanFilter(field_name='is_available')
    created_after = filters.DateFilter(field_name='created_at', lookup_expr='gte')
    created_before = filters.DateFilter(field_name='created_at', lookup_expr='lte')
    min_guests = filters.NumberFilter(field_name='max_guests', lookup_expr='gte')
    location = filters.CharFilter(method='filter_location')

    def filter_location(self, queryset, name, value):
        return queryset.filter(
            Q(address__icontains=value) |
            Q(city__icontains=value) |
            Q(state__icontains=value) |
            Q(country__icontains=value)
        )

    ordering = filters.OrderingFilter(
        fields=(
            ('price', 'price'),
            ('created_at', 'created_at'),
            ('bedrooms', 'bedrooms'),
            ('square_footage', 'square_footage'),
            ('title', 'title'),
        )
    )

    class Meta:
        model = Listing
        fields = {
            'title': ['icontains'],
            'description': ['icontains'],
            'property_type': ['exact', 'icontains'],
            'address': ['icontains'],
        }