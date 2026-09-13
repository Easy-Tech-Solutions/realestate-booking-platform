"""
Backfill the personalized Property Owner Agreement PDF for existing APPROVED
host applications that were approved before the PDF-on-approval feature existed.

Going forward the PDF is generated automatically on final approval
(see hostapplications.services._generate_agreement_safely). This command only
fills the gap for pre-existing approved hosts.

Usage (inside the backend container, which has WeasyPrint's system libraries):

    python manage.py backfill_owner_agreements            # generate for those missing one
    python manage.py backfill_owner_agreements --dry-run  # show what would be generated
    python manage.py backfill_owner_agreements --force    # regenerate for ALL approved (e.g. after a version bump)
"""

from django.core.management.base import BaseCommand
from django.db.models import Q

from hostapplications import agreements
from hostapplications.models import HostApplication


class Command(BaseCommand):
    help = (
        'Generate the personalized Property Owner Agreement PDF for existing '
        'approved host applications. Skips applications that already have a '
        'stored document unless --force is given.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--force', action='store_true',
            help='Regenerate even for applications that already have a stored '
                 'agreement (e.g. after bumping the agreement version).',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='List what would be generated without writing anything.',
        )

    def handle(self, *args, **options):
        force = options['force']
        dry_run = options['dry_run']

        qs = HostApplication.objects.filter(status=HostApplication.Status.APPROVED)
        if not force:
            # A FileField with no file stores '' (or NULL when null=True) — either
            # means "no document yet".
            qs = qs.filter(Q(agreement_document='') | Q(agreement_document__isnull=True))
        qs = qs.select_related('applicant').order_by('pk')

        total = qs.count()
        mode = ' (dry run)' if dry_run else (' (force regenerate)' if force else '')
        self.stdout.write(f'{total} approved application(s) to process{mode}.')

        generated = 0
        failed = 0
        for app in qs.iterator():
            label = f'#{app.pk} ({app.applicant.username})'
            if dry_run:
                self.stdout.write(f'  would generate: {label}')
                continue
            try:
                agreements.generate_and_store_owner_agreement(app)
                generated += 1
                self.stdout.write(self.style.SUCCESS(f'  generated: {label}'))
            except Exception as exc:
                failed += 1
                self.stderr.write(self.style.ERROR(f'  FAILED: {label} — {exc}'))

        if not dry_run:
            summary = f'Done. Generated {generated}, failed {failed}.'
            style = self.style.WARNING if failed else self.style.SUCCESS
            self.stdout.write(style(summary))
