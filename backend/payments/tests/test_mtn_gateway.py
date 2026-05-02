from payments.models import PaymentGateway, Currency
from payments.gateways.mtn_momo import MTNMoMoGateway

def test_mtn_gateway():
    # Create test gateway configuration
    gateway = PaymentGateway.objects.create(
        name='mtn_momo',
        api_key='test_api_key',
        merchant_id='test_merchant_id',
        secret_key='test_secret_key',
        business_number='123456',
        sandbox_mode=True
    )

    # Initialize gateway
    mtn_gateway = MTNMoMoGateway(gateway)

    # Test payment processing
    payment_data = {
        'amount': 1000,
        'phone_number': '0886123456',
        'currency': 'LRD',
        'reference': 'TEST_001'
    }

    result = mtn_gateway.process_payment(payment_data)
    print("Payment Result:", result)

    # Test phone validation
    valid_phones = ['0886123456', '+231886123456', '886123456']
    invalid_phones = ['123456', '08881234567', 'invalid']

    for phone in valid_phones:
        print(f"Valid phone {phone}: {mtn_gateway._validate_liberian_phone(phone)}")
    
    for phone in invalid_phones:
        print(f"Invalid phone {phone}: {mtn_gateway._validate_liberian_phone(phone)}")


if __name__ == '__main__':
    test_mtn_gateway()