from django.http import HttpRequest, HttpResponse


def momo_webhook(request: HttpRequest) -> HttpResponse:
    # Validate signature and update transaction status
    return HttpResponse(status=200)
