from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Pre-load and warm up the AI model so the first task has no cold-start delay.'

    def handle(self, *args, **options):
        from aiscoring.model_service import warmup, ModelUnavailable
        try:
            self.stdout.write('Warming up AI model...')
            warmup()
            self.stdout.write(self.style.SUCCESS('AI model warm and ready.'))
        except ModelUnavailable as e:
            self.stdout.write(self.style.WARNING(f'Model not available, skipping warmup: {e}'))
        except Exception as e:
            self.stdout.write(self.style.WARNING(f'Warmup failed, worker will cold-start: {e}'))
