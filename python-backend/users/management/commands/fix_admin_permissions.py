from django.core.management.base import BaseCommand
from users.models import User

class Command(BaseCommand):
    help = 'Fix admin user permissions'

    def handle(self, *args, **options):
        try:
            # Get the admin user (replace with your actual username)
            admin_user = User.objects.get(username='your_admin_username')  # Replace with your username
            
            # Force update the role and permissions
            admin_user.role = 'admin'
            admin_user.is_staff = True
            admin_user.is_superuser = True
            admin_user.save()
            
            self.stdout.write(
                self.style.SUCCESS(f'Successfully updated {admin_user.username}:')
            )
            self.stdout.write(f'  Role: {admin_user.role}')
            self.stdout.write(f'  Is Staff: {admin_user.is_staff}')
            self.stdout.write(f'  Is Superuser: {admin_user.is_superuser}')
            self.stdout.write(f'  Is Active: {admin_user.is_active}')
            
        except User.DoesNotExist:
            self.stdout.write(
                self.style.ERROR('Admin user not found. Please check the username.')
            )
        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'Error: {str(e)}')
            )
