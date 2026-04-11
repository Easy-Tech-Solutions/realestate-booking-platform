from django_filters import rest_framework as filters 
from . models import Listing

class ListingFilter(filters.FilterSet):
    #Explicit filter fields for better API design
    min_price = filters.NumberFilter(field_name='price', lookup_expr='gte')
    max_price = filters.NumberFilter(field_name='price', lookup_expr='lte')
    min_bedrooms = filters.NumberFilter(field_name='bedrooms', lookup_expr='gte')
    max_bedrooms = filters.NumberFilter(field_name='bedrooms', lookup_expr='lte')
    min_square_footage = filters.NumberFilter(field_name='square_footage', lookup_expr='gte')
    max_square_footage = filters.NumberFilter(field_name='square_footage', lookup_expr='lte')
    owner_id = filters.NumberFilter(field_name='owner__id', lookup_expr='exact')

    # Exact match filters for choice fields
    property_type_exact = filters.ChoiceFilter(field_name='property_type', choices=Listing.PROPERTY_TYPES)

    # Boolean filter for availability
    is_available = filters.BooleanFilter(field_name='is_available')

    # Date range filters
    created_after = filters.DateFilter(field_name='created_at', lookup_expr='gte')
    created_before = filters.DateFilter(field_name="created_at", lookup_expr='lte')

    #Search and ordering filters
    ordering = filters.OrderingFilter(
        fields = (
            ('price','price'),
            ('created_at', 'created_at'), 
            ('bedrooms', 'bedrooms'),  
            ('square_footage', 'square_footage'),
            ('title', 'title')  
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