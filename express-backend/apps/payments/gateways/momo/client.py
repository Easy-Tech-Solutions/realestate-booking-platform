import requests


class MomoClient:
    def __init__(self, api_key: str, api_secret: str):
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = "https://api.momo.example.com"

    def charge(self, phone: str, amount: str, currency: str = "USD") -> dict:
        # Implement MOMO charge
        return {"status": "pending", "reference": "momo_ref_123"}
