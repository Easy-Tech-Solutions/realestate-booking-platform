from django.http import JsonResponse


def metrics_health(_request):
    return JsonResponse({"status": "ok"})
