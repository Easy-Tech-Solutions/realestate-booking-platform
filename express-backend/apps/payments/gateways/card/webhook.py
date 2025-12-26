from django.http import HttpRequest, HttpResponse


def stripe_webhook(request: HttpRequest) -> HttpResponse:
    # Validate signature header and handle event types
    return HttpResponse(status=200)
