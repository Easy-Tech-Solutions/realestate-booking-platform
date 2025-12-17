from django.http import JsonResponse


def cms_health(_request):
    return JsonResponse({"status": "ok"})
