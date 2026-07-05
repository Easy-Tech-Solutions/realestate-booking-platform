"""
HTTP request/response logging middleware.

Writes one INFO entry per request to homekonet.application (→ application.log).

Logged fields: method, path, status_code, duration_ms, user_id, ip.
Sensitive paths (passwords, tokens) are NOT redacted here because the path
itself is never sensitive — only request bodies could be, and we do not log
those.
"""
import logging
import time

_logger = logging.getLogger('homekonet.application')


def _get_client_ip(request) -> str:
    xff = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if xff:
        return xff.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '')


class RequestLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        t0 = time.monotonic()
        response = self.get_response(request)
        duration_ms = round((time.monotonic() - t0) * 1000, 1)

        # request.user is populated by AuthenticationMiddleware which runs
        # before this middleware in the stack.
        user = getattr(request, 'user', None)
        user_id = user.id if (user is not None and getattr(user, 'is_authenticated', False)) else None

        _logger.info(
            '%s %s %s',
            request.method,
            request.path,
            response.status_code,
            extra={
                'method': request.method,
                'path': request.path,
                'status_code': response.status_code,
                'duration_ms': duration_ms,
                'user_id': user_id,
                'ip': _get_client_ip(request),
            },
        )
        return response
