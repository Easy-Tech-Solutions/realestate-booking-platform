from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from rbac.permissions import has_permission
from superadmin.permissions import is_superadmin_staff, log_admin_action

from .registry import get_config
from .serializers import get_serializer_class


class _GenericAdminPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


def _authorize(request, config, action):
    """Returns an error Response, or None if the caller may proceed."""
    if not is_superadmin_staff(request.user) or not has_permission(request.user, config.resource, action):
        return Response({'error': f'{config.resource} access required'}, status=status.HTTP_403_FORBIDDEN)
    return None


def _apply_search(qs, request, config):
    search = request.query_params.get('search', '').strip()
    if not search or not config.search_fields:
        return qs
    q = Q()
    for f in config.search_fields:
        q |= Q(**{f'{f}__icontains': search})
    return qs.filter(q)


def _apply_filters(qs, request, config):
    for f in config.filterable_fields:
        val = request.query_params.get(f)
        if val is None:
            continue
        if val in ('true', 'false'):
            val = val == 'true'
        qs = qs.filter(**{f: val})
    return qs


def _ordering(request, config):
    raw = request.query_params.get('ordering', config.default_ordering)
    if raw.lstrip('-') not in config.ordering_fields:
        return config.default_ordering
    return raw


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def generic_list_create(request, model_key):
    config = get_config(model_key)
    action = 'read' if request.method == 'GET' else 'create'
    denied = _authorize(request, config, action)
    if denied:
        return denied

    serializer_class = get_serializer_class(model_key, config)

    if request.method == 'GET':
        qs = config.model.objects.all().order_by(_ordering(request, config))
        qs = _apply_search(_apply_filters(qs, request, config), request, config)
        paginator = _GenericAdminPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(serializer_class(page, many=True).data)

    if config.read_only:
        return Response({'error': 'This resource is read-only.'}, status=status.HTTP_403_FORBIDDEN)

    serializer = serializer_class(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    instance = serializer.save()
    log_admin_action(request, f'{config.audit_label}.create', target=instance,
                      reason=str(request.data.get('reason', '')))
    return Response(serializer_class(instance).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def generic_detail(request, model_key, pk):
    config = get_config(model_key)
    action = {'GET': 'read', 'PATCH': 'update', 'DELETE': 'delete'}[request.method]
    denied = _authorize(request, config, action)
    if denied:
        return denied

    instance = get_object_or_404(config.model, pk=pk)
    serializer_class = get_serializer_class(model_key, config)

    if request.method == 'GET':
        return Response(serializer_class(instance).data)

    if config.read_only:
        return Response({'error': 'This resource is read-only.'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'PATCH':
        serializer = serializer_class(instance, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        updated = serializer.save()
        log_admin_action(request, f'{config.audit_label}.update', target=updated,
                          reason=str(request.data.get('reason', '')), fields=list(request.data.keys()))
        return Response(serializer_class(updated).data)

    # DELETE
    repr_before, pk_before = str(instance), instance.pk
    instance.delete()
    log_admin_action(request, f'{config.audit_label}.delete', target=None,
                      reason=str(request.data.get('reason', '')), deleted_id=pk_before, deleted_repr=repr_before)
    return Response(status=status.HTTP_204_NO_CONTENT)
