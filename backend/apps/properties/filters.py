import django_filters
from .models.property import Property


class PropertyFilter(django_filters.FilterSet):
    min_price = django_filters.NumberFilter(field_name="base_price", lookup_expr="gte")
    max_price = django_filters.NumberFilter(field_name="base_price", lookup_expr="lte")
    type = django_filters.CharFilter(field_name="type", lookup_expr="iexact")
    category = django_filters.CharFilter(field_name="category__slug", lookup_expr="iexact")
    city = django_filters.CharFilter(field_name="location__city", lookup_expr="icontains")

    class Meta:
        model = Property
        fields = ["type", "category", "city", "min_price", "max_price"]
