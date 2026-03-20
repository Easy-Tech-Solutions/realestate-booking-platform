from rest_framework.throttling import SimpleRateThrottle


class BurstRateThrottle(SimpleRateThrottle):
    scope = "burst"

    def get_cache_key(self, request, view):
        ident = self.get_ident(request)
        return self.cache_format % {
            'scope': self.scope,
            'ident': ident,
        }


class SustainedRateThrottle(SimpleRateThrottle):
    scope = "sustained"

    def get_cache_key(self, request, view):
        ident = self.get_ident(request)
        return self.cache_format % {
            'scope': self.scope,
            'ident': ident,
        }
