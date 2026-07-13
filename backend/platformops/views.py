import json
import shutil
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import FeatureFlag, TaskHeartbeat
from .serializers import FeatureFlagSerializer, TaskHeartbeatSerializer


def _require_engineering(request):
    """Full admins (superadmin) always pass; is_staff accounts need the
    engineering department (legacy) OR a custom role granting
    infrastructure.feature_flags/system_caches directly."""
    from superadmin.permissions import is_superadmin_staff, require_department
    from rbac.permissions import has_any_permission
    user = request.user
    if not is_superadmin_staff(user):
        return False
    return (
        require_department(user, 'engineering')
        or has_any_permission(user, 'infrastructure.feature_flags') or has_any_permission(user, 'infrastructure.system_caches')
    )


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def feature_flags_collection(request):
    if not _require_engineering(request):
        return Response({'error': 'Platform & Engineering access required'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'GET':
        qs = FeatureFlag.objects.select_related('updated_by').all()
        return Response(FeatureFlagSerializer(qs, many=True).data)

    serializer = FeatureFlagSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    flag = serializer.save(updated_by=request.user)

    from superadmin.permissions import log_admin_action
    log_admin_action(request, 'feature_flag.create', target=flag, reason=flag.description, is_enabled=flag.is_enabled)

    return Response(FeatureFlagSerializer(flag).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def feature_flag_detail(request, pk):
    if not _require_engineering(request):
        return Response({'error': 'Platform & Engineering access required'}, status=status.HTTP_403_FORBIDDEN)

    flag = get_object_or_404(FeatureFlag, pk=pk)

    if request.method == 'DELETE':
        from superadmin.permissions import log_admin_action
        log_admin_action(request, 'feature_flag.delete', target=flag)
        flag.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = FeatureFlagSerializer(flag, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    flag = serializer.save(updated_by=request.user)

    from superadmin.permissions import log_admin_action
    log_admin_action(request, 'feature_flag.update', target=flag, reason=flag.description, is_enabled=flag.is_enabled)

    return Response(FeatureFlagSerializer(flag).data)


def _check_database():
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
        return {'ok': True}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def _check_redis():
    try:
        import redis as redis_lib
        client = redis_lib.from_url(settings.CELERY_BROKER_URL, socket_connect_timeout=2, socket_timeout=2)
        client.ping()
        return {'ok': True}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def _check_celery_workers():
    try:
        from realestate_backend.celery import app as celery_app
        replies = celery_app.control.inspect(timeout=2).ping() or {}
        return {'ok': len(replies) > 0, 'worker_count': len(replies), 'workers': list(replies.keys())}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def _check_disk():
    try:
        total, used, free = shutil.disk_usage('/')
        return {'ok': free / total > 0.1, 'total_gb': round(total / 1e9, 1), 'free_gb': round(free / 1e9, 1), 'used_percent': round(used / total * 100, 1)}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def _recent_error_count(minutes=60):
    log_path = Path(settings.BASE_DIR) / 'logs' / 'errors.log'
    if not log_path.exists():
        return 0
    cutoff = timezone.now() - timezone.timedelta(minutes=minutes)
    count = 0
    try:
        with log_path.open('r') as f:
            lines = f.readlines()[-2000:]
        for line in lines:
            try:
                entry = json.loads(line)
                ts = entry.get('ts')
                if ts:
                    from django.utils.dateparse import parse_datetime
                    dt = parse_datetime(ts)
                    if dt and dt.tzinfo is None:
                        dt = timezone.make_aware(dt)
                    if dt and dt >= cutoff:
                        count += 1
                else:
                    count += 1
            except (json.JSONDecodeError, ValueError):
                continue
    except Exception:
        return count
    return count


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def system_health(request):
    if not _require_engineering(request):
        return Response({'error': 'Platform & Engineering access required'}, status=status.HTTP_403_FORBIDDEN)

    heartbeats = TaskHeartbeat.objects.all()
    return Response({
        'database': _check_database(),
        'redis': _check_redis(),
        'celery_workers': _check_celery_workers(),
        'disk': _check_disk(),
        'recent_errors_last_hour': _recent_error_count(60),
        'scheduled_tasks': TaskHeartbeatSerializer(heartbeats, many=True).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def recent_errors(request):
    """Tail the last N lines of errors.log for a quick in-dashboard look
    without shelling into the server. No aggregation/alerting — just a
    read-only view over the same rotating file logging_config.py already
    writes to."""
    if not _require_engineering(request):
        return Response({'error': 'Platform & Engineering access required'}, status=status.HTTP_403_FORBIDDEN)

    limit = min(int(request.query_params.get('limit', 100)), 500)
    log_path = Path(settings.BASE_DIR) / 'logs' / 'errors.log'
    if not log_path.exists():
        return Response([])

    entries = []
    try:
        with log_path.open('r') as f:
            lines = f.readlines()[-limit:]
        for line in reversed(lines):
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                entries.append({'raw': line.strip()})
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    return Response(entries)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def flush_cache(request):
    """Clears the configured Django cache backend (Redis in production, via
    DJANGO_USE_DB_CACHE/REDIS_URL — see settings.py). A real, if blunt,
    'system_caches' execute action: everything cached gets recomputed on
    next access, which is the correct recovery step if cached data is stale
    or a deploy changed what a cache key should mean."""
    if not _require_engineering(request):
        return Response({'error': 'Platform & Engineering access required'}, status=status.HTTP_403_FORBIDDEN)

    from django.core.cache import cache
    try:
        cache.clear()
    except Exception as e:
        return Response({'error': f'Cache flush failed: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    from superadmin.permissions import log_admin_action
    log_admin_action(request, 'infrastructure.cache_flush')

    return Response({'ok': True, 'message': 'Cache cleared.'})
