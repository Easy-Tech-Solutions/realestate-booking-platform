from django.core.management.base import BaseCommand
from users.models import User


class Command(BaseCommand):
    help = 'Fix admin user permissions'

    def add_arguments(self, parser):
        parser.add_argument(
            '--username',
            type=str,
            help='Optional username to repair. If omitted, all admin/staff/superusers are repaired.',
        )

    def handle(self, *args, **options):
        try:
            username = options.get('username')
            if username:
                users = User.objects.filter(username=username)
            else:
                users = User.objects.filter(role='admin') | User.objects.filter(is_staff=True) | User.objects.filter(is_superuser=True)
                users = users.distinct()

            if not users.exists():
                self.stdout.write(self.style.ERROR('No matching admin/staff users found.'))
                return

            for admin_user in users:
                admin_user.role = 'admin'
                admin_user.is_staff = True
                admin_user.is_superuser = True
                admin_user.is_active = True
                admin_user.save()

                self.stdout.write(
                    self.style.SUCCESS(f'Successfully updated {admin_user.username}:')
                )
                self.stdout.write(f'  Role: {admin_user.role}')
                self.stdout.write(f'  Is Staff: {admin_user.is_staff}')
                self.stdout.write(f'  Is Superuser: {admin_user.is_superuser}')
                self.stdout.write(f'  Is Active: {admin_user.is_active}')
        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'Error: {str(e)}')
            )
