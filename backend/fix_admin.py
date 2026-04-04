#!/usr/bin/env python
import os
import sys
import django

# Add the project directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Set up Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'realestate_backend.settings')
django.setup()

from users.models import User

def fix_admin_user():
    print("Checking for admin users...")
    
    # Find all users with admin role
    admin_users = User.objects.filter(role='admin')
    
    if not admin_users.exists():
        print("No users with role='admin' found.")
        print("All users:")
        for user in User.objects.all():
            print(f"  - {user.username}: role='{user.role}', staff={user.is_staff}, superuser={user.is_superuser}")
        return
    
    for user in admin_users:
        print(f"\nFound admin user: {user.username}")
        print(f"Current state:")
        print(f"  Role: {user.role}")
        print(f"  Is Staff: {user.is_staff}")
        print(f"  Is Superuser: {user.is_superuser}")
        print(f"  Is Active: {user.is_active}")
        
        # Fix the permissions
        user.is_staff = True
        user.is_superuser = True
        user.save()
        
        print(f"Fixed state:")
        print(f"  Role: {user.role}")
        print(f"  Is Staff: {user.is_staff}")
        print(f"  Is Superuser: {user.is_superuser}")
        print(f"  Is Active: {user.is_active}")
        print(f"  Can access admin: {user.is_staff and user.is_active}")

if __name__ == '__main__':
    fix_admin_user()
