import logging

from django.http import JsonResponse

logger = logging.getLogger(__name__)


def handler_404(request, exception=None):
    logger.warning(
        '404 not_found',
        extra={'method': request.method, 'path': request.path},
    )
    return JsonResponse({'error': 'Not found'}, status=404)


def handler_500(request):
    logger.error(
        '500 internal_server_error',
        extra={'method': request.method, 'path': request.path},
        exc_info=True,
    )
    return JsonResponse({'error': 'Internal server error'}, status=500)
