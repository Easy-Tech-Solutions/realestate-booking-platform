"""
Staff-facing "User Management" endpoints — list/search, create, edit,
change email, reset password, activate/deactivate, soft-delete (anonymize),
hard-delete (guarded, dual-authed when it would destroy real history), and
bulk variants of the above.

Distinct from the self-service endpoints in views.py (which only ever act on
`request.user`) and from `user_detail`/`users_collection` (public/legacy,
left untouched for backward compatibility).
"""
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.contrib.auth.password_validation import validate_password
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from rbac import dual_auth
from rbac.permissions import has_permission, is_full_admin
from superadmin.permissions import is_superadmin_staff, log_admin_action

from .models import Profile
from .deletion import delete_account
from .serializers import AdminUserSerializer

User = get_user_model()


def _require_users(request, action, resource='users.profiles'):
    """Full admins always pass; is_staff accounts need a custom role
    granting the given users.* resource+action directly."""
    if not is_superadmin_staff(request.user):
        return False
    return has_permission(request.user, resource, action)


class _AdminUserPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


# ---------------------------------------------------------------------------
# List / detail / create
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_user_list(request):
    """GET /api/users/admin/list/ — paginated, searchable, filterable."""
    if not _require_users(request, 'read'):
        return Response({'error': 'users.profiles access required'}, status=status.HTTP_403_FORBIDDEN)

    qs = User.objects.select_related('profile').order_by('-date_joined')

    search = request.query_params.get('search', '').strip()
    if search:
        qs = qs.filter(
            Q(username__icontains=search) | Q(email__icontains=search)
            | Q(first_name__icontains=search) | Q(last_name__icontains=search)
        )
    role_filter = request.query_params.get('role')
    if role_filter:
        qs = qs.filter(role=role_filter)
    active_filter = request.query_params.get('is_active')
    if active_filter in ('true', 'false'):
        qs = qs.filter(is_active=(active_filter == 'true'))
    staff_filter = request.query_params.get('is_staff')
    if staff_filter in ('true', 'false'):
        qs = qs.filter(is_staff=(staff_filter == 'true'))

    paginator = _AdminUserPagination()
    page = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response(AdminUserSerializer(page, many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_user_detail(request, id):
    if not _require_users(request, 'read'):
        return Response({'error': 'users.profiles access required'}, status=status.HTTP_403_FORBIDDEN)
    target = get_object_or_404(User.objects.select_related('profile'), pk=id)
    return Response(AdminUserSerializer(target).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_create_user(request):
    """Manually provision a user account (e.g. on behalf of someone who
    called in). Admin ('role=admin') accounts are intentionally not
    createable here — same restriction as self-service profile updates;
    those are provisioned via shell only."""
    if not _require_users(request, 'create'):
        return Response({'error': 'users.profiles access required'}, status=status.HTTP_403_FORBIDDEN)

    data = request.data
    username = str(data.get('username', '')).strip()
    email = str(data.get('email', '')).strip().lower()
    password = str(data.get('password') or '').strip()
    first_name = str(data.get('first_name', '')).strip()
    last_name = str(data.get('last_name', '')).strip()
    role = data.get('role', 'user')

    if not username or not email:
        return Response({'error': 'username and email are required.'}, status=status.HTTP_400_BAD_REQUEST)
    if role not in ('user', 'agent'):
        return Response(
            {'error': "role must be 'user' or 'agent' — admin accounts must be provisioned via shell."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if User.objects.filter(username=username).exists():
        return Response({'error': 'That username is already taken.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        validate_email(email)
    except DjangoValidationError:
        return Response({'error': 'Invalid email format.'}, status=status.HTTP_400_BAD_REQUEST)
    if User.objects.filter(email__iexact=email).exists():
        return Response({'error': 'Another account already uses this email.'}, status=status.HTTP_400_BAD_REQUEST)

    generated_password = None
    if not password:
        import secrets
        password = secrets.token_urlsafe(12)
        generated_password = password
    else:
        try:
            validate_password(password)
        except DjangoValidationError as e:
            return Response({'error': ' '.join(e.messages)}, status=status.HTTP_400_BAD_REQUEST)

    user = User(
        username=username, email=email, first_name=first_name, last_name=last_name,
        role=role, email_verified=True,  # staff-created accounts are pre-verified
    )
    user.set_password(password)
    user.save()
    Profile.objects.get_or_create(user=user)

    log_admin_action(request, 'user.create', target=user, reason=str(data.get('reason', '')), role=role)

    resp = AdminUserSerializer(user).data
    if generated_password:
        resp['generated_password'] = generated_password
    return Response(resp, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# Update basic fields / email / password
# ---------------------------------------------------------------------------

@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def admin_update_user(request, id):
    if not _require_users(request, 'update'):
        return Response({'error': 'users.profiles access required'}, status=status.HTTP_403_FORBIDDEN)

    target = get_object_or_404(User, pk=id)
    data = request.data
    changed = []

    if 'first_name' in data:
        target.first_name = str(data['first_name'] or '')[:150]
        changed.append('first_name')
    if 'last_name' in data:
        target.last_name = str(data['last_name'] or '')[:150]
        changed.append('last_name')
    role_changed_to_admin = False
    role_changed_away_from_admin = False
    if 'role' in data:
        if target.role == 'superadmin' or data['role'] == 'superadmin':
            return Response(
                {'error': 'Superadmin role changes are not permitted from this dashboard — use the shell.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if data['role'] not in ('user', 'agent', 'admin'):
            return Response({'error': "role must be 'user', 'agent', or 'admin'."}, status=status.HTTP_400_BAD_REQUEST)
        if target.role != data['role']:
            if data['role'] == 'admin' and not is_full_admin(request.user):
                return Response({'error': 'Only a superadmin can grant the Admin role.'}, status=status.HTTP_403_FORBIDDEN)
            role_changed_to_admin = data['role'] == 'admin'
            role_changed_away_from_admin = target.role == 'admin' and data['role'] != 'admin'
            target.role = data['role']
            changed.append('role')
            changed.append('is_staff')  # save() may flip is_staff as a side effect of the role change

    if not changed:
        return Response({'error': 'No recognized fields to update.'}, status=status.HTTP_400_BAD_REQUEST)

    target.save(update_fields=changed)

    if role_changed_to_admin or role_changed_away_from_admin:
        from rbac.models import Role, UserRoleAssignment
        admin_role = Role.objects.filter(slug='admin').first()
        if admin_role:
            if role_changed_to_admin:
                UserRoleAssignment.objects.get_or_create(user=target, role=admin_role, defaults={'granted_by': request.user})
            else:
                UserRoleAssignment.objects.filter(user=target, role=admin_role).delete()

    log_admin_action(request, 'user.update', target=target, reason=str(data.get('reason', '')), fields=changed)
    return Response(AdminUserSerializer(target).data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def admin_change_email(request, id):
    """Change a user's email on their behalf (e.g. they lost access to the
    old inbox and called support). Gated under users.pii — more sensitive
    than a name edit."""
    if not _require_users(request, 'update', resource='users.pii'):
        return Response({'error': 'users.pii access required'}, status=status.HTTP_403_FORBIDDEN)

    target = get_object_or_404(User, pk=id)
    new_email = str(request.data.get('email', '')).strip().lower()
    if not new_email:
        return Response({'error': 'A valid email is required.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        validate_email(new_email)
    except DjangoValidationError:
        return Response({'error': 'Invalid email format.'}, status=status.HTTP_400_BAD_REQUEST)
    if User.objects.filter(email__iexact=new_email).exclude(pk=target.pk).exists():
        return Response({'error': 'Another account already uses this email.'}, status=status.HTTP_400_BAD_REQUEST)

    old_email = target.email
    target.email = new_email
    target.email_verified = False
    target.save(update_fields=['email', 'email_verified'])

    log_admin_action(
        request, 'user.change_email', target=target, reason=str(request.data.get('reason', '')),
        old_email=old_email, new_email=new_email,
    )
    return Response(AdminUserSerializer(target).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_reset_password(request, id):
    """Directly set a user's password on their behalf (e.g. they called in
    locked out). Blacklists their outstanding refresh tokens so every
    existing session is forced to log back in with the new password."""
    if not _require_users(request, 'update', resource='users.pii'):
        return Response({'error': 'users.pii access required'}, status=status.HTTP_403_FORBIDDEN)

    target = get_object_or_404(User, pk=id)
    new_password = str(request.data.get('password') or '')
    if not new_password:
        return Response({'error': 'A new password is required.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        validate_password(new_password, user=target)
    except DjangoValidationError as e:
        return Response({'error': ' '.join(e.messages)}, status=status.HTTP_400_BAD_REQUEST)

    target.set_password(new_password)
    target.save(update_fields=['password'])

    try:
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
        for token in OutstandingToken.objects.filter(user=target):
            BlacklistedToken.objects.get_or_create(token=token)
    except Exception:
        pass

    log_admin_action(request, 'user.reset_password', target=target, reason=str(request.data.get('reason', '')))
    return Response({'message': f"{target.username}'s password has been reset. They've been logged out of all devices."})


# ---------------------------------------------------------------------------
# Activate / deactivate
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_toggle_active(request, id):
    if not _require_users(request, 'delete'):
        return Response({'error': 'users.profiles access required'}, status=status.HTTP_403_FORBIDDEN)

    target = get_object_or_404(User, pk=id)
    if target.pk == request.user.pk:
        return Response({'error': "You can't deactivate your own account."}, status=status.HTTP_400_BAD_REQUEST)

    desired = request.data.get('is_active')
    if desired is None:
        return Response({'error': 'is_active (true/false) is required.'}, status=status.HTTP_400_BAD_REQUEST)
    desired = bool(desired)
    if is_full_admin(target) and not desired:
        return Response({'error': 'Cannot deactivate a superadmin account.'}, status=status.HTTP_400_BAD_REQUEST)

    target.is_active = desired
    target.save(update_fields=['is_active'])
    log_admin_action(
        request, 'user.activate' if desired else 'user.deactivate',
        target=target, reason=str(request.data.get('reason', '')),
    )
    return Response(AdminUserSerializer(target).data)


# ---------------------------------------------------------------------------
# Delete — soft (anonymize, preserves history) vs hard (guarded, dual-authed)
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_soft_delete_user(request, id):
    """Deactivate + anonymize (reuses the same logic as the self-service
    account-deletion flow). Booking/payment/review history is preserved —
    every FK stays intact and just renders as "Deleted User"."""
    if not _require_users(request, 'delete'):
        return Response({'error': 'users.profiles access required'}, status=status.HTTP_403_FORBIDDEN)

    target = get_object_or_404(User, pk=id)
    if target.pk == request.user.pk:
        return Response({'error': "You can't delete your own account from here."}, status=status.HTTP_400_BAD_REQUEST)
    if is_full_admin(target):
        return Response({'error': 'Cannot delete a superadmin account.'}, status=status.HTTP_400_BAD_REQUEST)

    reason = str(request.data.get('reason', '')).strip()
    if not reason:
        return Response({'error': 'A reason is required.'}, status=status.HTTP_400_BAD_REQUEST)

    snapshot_username = target.username
    ok, error = delete_account(target)
    if not ok:
        return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

    log_admin_action(request, 'user.soft_delete', target=target, reason=reason, original_username=snapshot_username)
    return Response({'message': f'"{snapshot_username}" has been deactivated and anonymized. Booking/payment history was preserved.'})


def _protected_record_counts(user):
    """Every real record that would be CASCADE-destroyed by a hard delete.
    Non-empty result means the account has genuine history."""
    from bookings.models import Booking
    from listings.models import Listing, Review
    from payments.models import Payment, Payout
    from messaging.models import Message
    from reports.models import Report
    from suspensions.models import Suspension
    from hostapplications.models import HostApplication, AgreementAcceptance
    from propertyverifications.models import PropertyVerification
    from support.models import AirCoverClaim, SupportTicket

    counts = {
        'bookings_as_guest': Booking.objects.filter(customer=user).count(),
        'bookings_as_host': Booking.objects.filter(listing__owner=user).count(),
        'listings': Listing.objects.filter(owner=user).count(),
        'reviews': Review.objects.filter(reviewer=user).count(),
        'payments': Payment.objects.filter(user=user).count(),
        'payouts': Payout.objects.filter(host=user).count(),
        'messages_sent': Message.objects.filter(sender=user).count(),
        'reports_filed': Report.objects.filter(reporter=user).count(),
        'suspensions': Suspension.objects.filter(user=user).count(),
        'host_applications': HostApplication.objects.filter(applicant=user).count(),
        'agreement_acceptances': AgreementAcceptance.objects.filter(user=user).count(),
        'property_verifications': PropertyVerification.objects.filter(applicant=user).count(),
        'aircover_claims': AirCoverClaim.objects.filter(claimant=user).count(),
        'support_tickets': SupportTicket.objects.filter(user=user).count(),
    }
    return {k: v for k, v in counts.items() if v > 0}


@dual_auth.register_executor('user.hard_delete')
def _execute_hard_delete(payload):
    target = User.objects.get(pk=payload['user_id'])
    username = target.username
    target.delete()
    return {'deleted_user_id': payload['user_id'], 'username': username}


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_hard_delete_user(request, id):
    """Real, irreversible SQL delete. Blocked outright if the account has any
    booking/payment/listing/review/etc. history unless `force=true` is
    passed — and even then, destroying real history always requires a
    second admin's approval via the dual-authorization engine. Accounts
    with zero history (spam/test signups) can be hard-deleted immediately."""
    if not _require_users(request, 'execute'):
        return Response({'error': 'users.profiles access required'}, status=status.HTTP_403_FORBIDDEN)

    target = get_object_or_404(User, pk=id)
    if target.pk == request.user.pk:
        return Response({'error': "You can't delete your own account."}, status=status.HTTP_400_BAD_REQUEST)
    if is_full_admin(target):
        return Response({'error': 'Cannot delete a superadmin account.'}, status=status.HTTP_400_BAD_REQUEST)

    reason = str(request.data.get('reason', '')).strip()
    if not reason:
        return Response({'error': 'A reason is required to permanently delete a user.'}, status=status.HTTP_400_BAD_REQUEST)
    force = bool(request.data.get('force'))

    protected = _protected_record_counts(target)
    if protected and not force:
        return Response({
            'error': 'This user has related records that a hard delete would permanently destroy.',
            'protected_records': protected,
            'hint': 'Pass force=true to proceed anyway (a second admin will need to approve it), or use soft-delete instead to preserve history.',
        }, status=status.HTTP_400_BAD_REQUEST)

    payload = {'user_id': target.id, 'reason': reason, 'initiated_by_id': request.user.id, 'force': force}
    requires_dual_auth = bool(protected)
    result, approval = dual_auth.submit_or_execute('user.hard_delete', payload, request.user, reason, requires_dual_auth)

    if approval:
        log_admin_action(
            request, 'user.hard_delete.requested', target=target, reason=reason,
            protected_records=protected, forced=force, approval_id=approval.id,
        )
        return Response(
            {'pending_approval': True, 'approval_id': approval.id,
             'message': 'This user has related records; a second admin must approve before permanent deletion executes.'},
            status=status.HTTP_202_ACCEPTED,
        )

    log_admin_action(
        request, 'user.hard_delete', target=None, reason=reason,
        deleted_user_id=result['deleted_user_id'], deleted_username=result['username'],
    )
    return Response({'message': f'User "{result["username"]}" permanently deleted.', 'deleted_user_id': result['deleted_user_id']})


# ---------------------------------------------------------------------------
# Bulk actions
# ---------------------------------------------------------------------------

_BULK_ACTION_RESOURCE = {
    'deactivate': ('users.profiles', 'delete'),
    'reactivate': ('users.profiles', 'delete'),
    'soft_delete': ('users.profiles', 'delete'),
    'hard_delete': ('users.profiles', 'execute'),
    'assign_role': ('rbac_engine', 'execute'),
    'remove_role': ('rbac_engine', 'execute'),
}


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_bulk_user_action(request):
    """Apply one action across many users at once. Hard-delete is
    deliberately NOT offered in bulk — it's too dangerous to batch."""
    action = request.data.get('action')
    user_ids = request.data.get('user_ids') or []
    reason = str(request.data.get('reason', '')).strip()
    role_id = request.data.get('role_id')

    if action not in _BULK_ACTION_RESOURCE:
        return Response({'error': f'Unknown action "{action}".'}, status=status.HTTP_400_BAD_REQUEST)
    if not isinstance(user_ids, list) or not user_ids:
        return Response({'error': 'user_ids (non-empty list) is required.'}, status=status.HTTP_400_BAD_REQUEST)
    if len(user_ids) > 200:
        return Response({'error': 'Bulk actions are capped at 200 users per request.'}, status=status.HTTP_400_BAD_REQUEST)
    if action in ('assign_role', 'remove_role') and not role_id:
        return Response({'error': 'role_id is required for this action.'}, status=status.HTTP_400_BAD_REQUEST)

    resource, perm_action = _BULK_ACTION_RESOURCE[action]
    if not _require_users(request, perm_action, resource=resource):
        return Response({'error': f'{resource} access required'}, status=status.HTTP_403_FORBIDDEN)

    results = {'succeeded': [], 'failed': []}
    targets = User.objects.filter(pk__in=user_ids)
    found_ids = {u.pk for u in targets}
    for missing_id in set(user_ids) - found_ids:
        results['failed'].append({'user_id': missing_id, 'error': 'Not found'})

    for target in targets:
        try:
            if target.pk == request.user.pk:
                raise ValueError("Can't act on your own account in bulk.")

            if action == 'deactivate':
                if is_full_admin(target):
                    raise ValueError('Cannot deactivate a superadmin account.')
                target.is_active = False
                target.save(update_fields=['is_active'])
            elif action == 'reactivate':
                target.is_active = True
                target.save(update_fields=['is_active'])
            elif action == 'soft_delete':
                if is_full_admin(target):
                    raise ValueError('Cannot delete a superadmin account.')
                ok, error = delete_account(target)
                if not ok:
                    raise ValueError(error)
            elif action == 'hard_delete':
                if is_full_admin(target):
                    raise ValueError('Cannot delete a superadmin account.')
                target.delete()
            elif action == 'assign_role':
                from rbac.models import Role, UserRoleAssignment
                role = Role.objects.get(pk=role_id)
                if role.slug == 'superadmin':
                    raise ValueError('The Superadmin role is reference-only — it cannot be assigned. Real superadmin status is granted via shell access only.')
                UserRoleAssignment.objects.get_or_create(user=target, role=role, defaults={'granted_by': request.user})
                update_fields = []
                if not target.is_staff:
                    target.is_staff = True
                    update_fields.append('is_staff')
                if role.slug == 'admin' and target.role not in ('admin', 'superadmin'):
                    target.role = 'admin'
                    update_fields.append('role')
                if update_fields:
                    target.save(update_fields=update_fields)
            elif action == 'remove_role':
                from rbac.models import Role, UserRoleAssignment
                UserRoleAssignment.objects.filter(user=target, role_id=role_id).delete()
                role = Role.objects.filter(pk=role_id).first()
                if role and role.slug == 'admin' and target.role == 'admin':
                    target.role = 'user'
                    target.save(update_fields=['role'])

            results['succeeded'].append(target.pk)
        except Exception as e:
            results['failed'].append({'user_id': target.pk, 'error': str(e)})

    log_admin_action(
        request, f'user.bulk_{action}', reason=reason, user_ids=user_ids,
        succeeded=results['succeeded'], failed=[f['user_id'] for f in results['failed']],
    )
    return Response(results)
