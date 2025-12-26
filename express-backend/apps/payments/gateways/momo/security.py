import hmac
import hashlib


def verify_signature(payload: bytes, signature: str, secret: str) -> bool:
    mac = hmac.new(secret.encode(), msg=payload, digestmod=hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, signature)
