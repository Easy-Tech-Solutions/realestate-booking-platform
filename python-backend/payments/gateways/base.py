from abc import ABC, abstractmethod
from typing import Dict, Any
from ..models import Payment, PaymentGateway

class PaymentGatewayBase(ABC):
    def __init__(self, gateway_config: PaymentGateway):
        self.gateway = gateway_config
        self.is_sandbox = gateway_config.sandbox_mode

    @abstractmethod
    def process_payment(self, payment_data: Dict[str, Any]) -> Dict[str, Any]:
        #Process payments and return responses
        pass

    @abstractmethod
    def verify_payment(self, transaction_id: str) -> Dict[str, Any]:
        #Verify payment status
        pass

    @abstractmethod
    def refund_payment(self, payment: Payment, amount: float, reason: str) -> Dict[str, Any]:
        #Process refund
        pass

    @abstractmethod
    def validate_webhook(self, payload: Dict[str, Any], signature: str) -> bool:
        #Validate webhook signature
        pass

    def get_api_url(self, endpoint: str) -> str:
        #Get full API URL for endpoint
        base_url = self.gateway.sandbox_url if self.gateway.sandbox_mode else self.gateway.live_url
        return f"{base_url}/{endpoint}"
    

    def log_webhook(self, event_type: str, payload: Dict[str, Any], processed: bool = False, error: str = None):
        #Log webhook for debugging
        from ..models import WebhookLog
        WebhookLog.objects.create(
            gateway=self.gateway,
            event_type=event_type,
            payload=payload,
            processed=processed,
            error_message=error or ''
        )

    