from django.utils import timezone
from .models import PropertyView

#Custom middleware for view tracking
class ViewTrackingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        #Track listing views
        if request.path.startswith('/api/listings/') and request.method == 'GET':
            try:
                #Extract listing ID from URL
                path_parts = request.path.strip('/').split('/')

                if (len(path_parts) >= 3 and path_parts[2].isdigit() and len(path_parts) == 3):
                    listing_id = int(path_parts[2])

                    #Doesn't track image views or stats endpoints
                    excluded_patterns = ['/images/','/stats/','/reviews/', '/favorites/', '/analytics/']
                    if not any(excluded in request.path for excluded in excluded_patterns):
                        PropertyView.objects.create(
                            listing_id=listing_id,
                            user=request.user if request.user.is_authenticated else None,
                            ip_address = self.get_client_ip(request),
                            user_agent = request.META.get('HTTP_USER_AGENT', '')  
                            )

            #Silently fail to not break request          
            except (ValueError, IndexError):
                pass
        
        return response
    
    #Extract client IP from request headers
    def get_client_ip(self, request):
        x_forward_for = request.META.get('HTTP_X_FORWARD_FOR')
        if x_forward_for:
            ip = x_forward_for.split(',')[0].strip()
        else:
            ip = request.META.get('REMOTE_ADDR')

        return ip 