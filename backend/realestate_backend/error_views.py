from django.http import JsonResponse


def handler_404(request, exception=None):
    return JsonResponse({'error': 'Not found'}, status=404)


def handler_500(request):
    return JsonResponse({'error': 'Internal server error'}, status=500)
