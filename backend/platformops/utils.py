from .models import FeatureFlag


def is_feature_enabled(key, default=False):
    flag = FeatureFlag.objects.filter(key=key).first()
    if flag is None:
        return default
    return flag.is_enabled
