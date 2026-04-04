#This file is created for initial currency data
from django.core.management.base import BaseCommand
from payments.models import Currency

class Command(BaseCommand):
    help = 'Initialize currencies for Liberia'

    def handle(self, *args, **options):
        currencies = [
            {
                'code': 'LRD',
                'name': 'Liberian Dollar',
                'symbol': 'L$',
                'exchange_rate_to_usd': 0.0054  # 1 LRD = 0.0054 USD
            },
            {
                'code': 'USD',
                'name': 'United States Dollar',
                'symbol': '$',
                'exchange_rate_to_usd': 1.0
            }
        ]

        for currency_data in currencies:
            currency, created = Currency.objects.get_or_create(
                code=currency_data['code'],
                defaults=currency_data
            )
            if created:
                self.stdout.write(
                    self.style.SUCCESS(f'Created currency: {currency.code}')
                )
            else:
                self.stdout.write(
                    self.style.WARNING(f'Currency already exists: {currency.code}')
                )