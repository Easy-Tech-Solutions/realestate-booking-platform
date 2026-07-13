from datetime import timedelta

from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from superadmin.permissions import is_superadmin_staff, log_admin_action
from . import dual_auth
from .models import Role, RolePermission, UserRoleAssignment, BreakGlassSession, PendingApproval
from .permissions import has_permission, has_role, effective_grants
from .resources import RESOURCE_TREE, ACTIONS, ACTION_LABELS
from .serializers import (
    RoleSerializer, RolePermissionSerializer, UserRoleAssignmentSerializer,
    BreakGlassSessionSerializer, PendingApprovalSerializer,
)

User = get_user_model()

MAX_BREAK_GLASS_HOURS = 8
DEFAULT_BREAK_GLASS_HOURS = 2

# Which (resource, action) an eligible approver must hold to review a given
# kind of pending approval — i.e. who counts as "the other set of eyes".
ACTION_KEY_RESOURCE = {
    'payment.refund': ('customer_support.vouchers', 'execute'),
    'user.suspend': ('trust_safety.bans', 'execute'),
}


def _require_rbac_engine(request, action='read'):
    if not is_superadmin_staff(request.user):
        return False
    return has_permission(request.user, 'rbac_engine', action)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def resource_tree(request):
    if not is_superadmin_staff(request.user):
        return Response({'error': 'Superadmin access required'}, status=status.HTTP_403_FORBIDDEN)
    tree = [
        {'path': path, 'label': label, 'wired': wired, 'note': note}
        for path, label, wired, note in RESOURCE_TREE
    ]
    return Response({'resources': tree, 'actions': [{'value': a, 'label': ACTION_LABELS[a]} for a in ACTIONS]})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_permissions(request):
    if not is_superadmin_staff(request.user):
        return Response({'error': 'Superadmin access required'}, status=status.HTTP_403_FORBIDDEN)
    grants = effective_grants(request.user)
    return Response({'grants': [{'resource': r, 'action': a} for r, a in sorted(grants)]})


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def roles_collection(request):
    action = 'read' if request.method == 'GET' else 'execute'
    if not _require_rbac_engine(request, action):
        return Response({'error': 'RBAC Engine access required'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'GET':
        return Response(RoleSerializer(Role.objects.all(), many=True).data)

    serializer = RoleSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    role = serializer.save(created_by=request.user, is_preset=False)

    log_admin_action(request, 'rbac.role.create', target=role, reason=role.description)
    return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def role_detail(request, pk):
    if not _require_rbac_engine(request, 'execute'):
        return Response({'error': 'RBAC Engine access required'}, status=status.HTTP_403_FORBIDDEN)

    role = get_object_or_404(Role, pk=pk)

    if request.method == 'DELETE':
        if role.is_preset:
            return Response(
                {'error': f'"{role.name}" is a preset role backing legacy department access — deleting it would silently break existing staff access. Edit its permissions instead.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        log_admin_action(request, 'rbac.role.delete', target=role)
        role.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = RoleSerializer(role, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    role = serializer.save()
    log_admin_action(request, 'rbac.role.update', target=role, reason=role.description)
    return Response(RoleSerializer(role).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def role_add_permission(request, pk):
    if not _require_rbac_engine(request, 'execute'):
        return Response({'error': 'RBAC Engine access required'}, status=status.HTTP_403_FORBIDDEN)

    role = get_object_or_404(Role, pk=pk)
    serializer = RolePermissionSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    perm, created = RolePermission.objects.get_or_create(role=role, **serializer.validated_data)
    log_admin_action(request, 'rbac.role.grant', target=role, reason=f'{perm.resource}.{perm.action}')
    return Response(RolePermissionSerializer(perm).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def role_remove_permission(request, pk, perm_id):
    if not _require_rbac_engine(request, 'execute'):
        return Response({'error': 'RBAC Engine access required'}, status=status.HTTP_403_FORBIDDEN)

    role = get_object_or_404(Role, pk=pk)
    perm = get_object_or_404(RolePermission, pk=perm_id, role=role)
    log_admin_action(request, 'rbac.role.revoke_grant', target=role, reason=f'{perm.resource}.{perm.action}')
    perm.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def user_roles_collection(request):
    action = 'read' if request.method == 'GET' else 'execute'
    if not _require_rbac_engine(request, action):
        return Response({'error': 'RBAC Engine access required'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'GET':
        qs = UserRoleAssignment.objects.select_related('user', 'role', 'granted_by')
        user_id = request.query_params.get('user_id')
        if user_id:
            qs = qs.filter(user_id=user_id)
        return Response(UserRoleAssignmentSerializer(qs, many=True).data)

    user_id = request.data.get('user')
    role_id = request.data.get('role')
    if not user_id or not role_id:
        return Response({'error': 'user and role are required'}, status=status.HTTP_400_BAD_REQUEST)
    target_user = get_object_or_404(User, pk=user_id)
    role = get_object_or_404(Role, pk=role_id)

    assignment, created = UserRoleAssignment.objects.get_or_create(
        user=target_user, role=role, defaults={'granted_by': request.user},
    )
    # Every permission check in this codebase gates on is_staff first (it's
    # "can this person into /superadmin at all", roles/departments scope what
    # they see once there) — assigning a role with no visible effect because
    # is_staff was never separately flipped would be a confusing gotcha.
    if not target_user.is_staff:
        target_user.is_staff = True
        target_user.save(update_fields=['is_staff'])

    log_admin_action(request, 'rbac.user_role.assign', target=assignment, reason=f'{target_user.username} -> {role.slug}')
    return Response(UserRoleAssignmentSerializer(assignment).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def user_role_detail(request, pk):
    if not _require_rbac_engine(request, 'execute'):
        return Response({'error': 'RBAC Engine access required'}, status=status.HTTP_403_FORBIDDEN)

    assignment = get_object_or_404(UserRoleAssignment, pk=pk)
    log_admin_action(request, 'rbac.user_role.revoke', target=assignment, reason=f'{assignment.user.username} x {assignment.role.slug}')
    assignment.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Break-glass
# ---------------------------------------------------------------------------

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def break_glass_collection(request):
    if not is_superadmin_staff(request.user):
        return Response({'error': 'Superadmin access required'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'GET':
        qs = BreakGlassSession.objects.select_related('user', 'revoked_by')
        if not has_permission(request.user, 'rbac_engine', 'read'):
            qs = qs.filter(user=request.user)
        return Response(BreakGlassSessionSerializer(qs, many=True).data)

    if not (has_role(request.user, 'engineering') or has_permission(request.user, 'infrastructure.break_glass', 'execute')):
        return Response({'error': 'Break-glass access is limited to the engineering role.'}, status=status.HTTP_403_FORBIDDEN)

    reason = str(request.data.get('reason', '')).strip()
    if not reason:
        return Response({'error': 'A reason is required to request break-glass access.'}, status=status.HTTP_400_BAD_REQUEST)

    if BreakGlassSession.objects.filter(user=request.user, revoked_at__isnull=True, expires_at__gt=timezone.now()).exists():
        return Response({'error': 'You already have an active break-glass session.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        hours = min(float(request.data.get('hours', DEFAULT_BREAK_GLASS_HOURS)), MAX_BREAK_GLASS_HOURS)
    except (TypeError, ValueError):
        hours = DEFAULT_BREAK_GLASS_HOURS

    session = BreakGlassSession.objects.create(
        user=request.user, reason=reason, expires_at=timezone.now() + timedelta(hours=hours),
    )
    log_admin_action(request, 'rbac.break_glass.grant', target=session, reason=reason, expires_at=session.expires_at.isoformat())
    return Response(BreakGlassSessionSerializer(session).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def break_glass_revoke(request, pk):
    if not is_superadmin_staff(request.user):
        return Response({'error': 'Superadmin access required'}, status=status.HTTP_403_FORBIDDEN)

    session = get_object_or_404(BreakGlassSession, pk=pk)
    if session.user_id != request.user.id and not has_permission(request.user, 'rbac_engine', 'execute'):
        return Response({'error': 'Only the session holder or an RBAC Engine admin can revoke this.'}, status=status.HTTP_403_FORBIDDEN)
    if not session.is_active:
        return Response({'error': 'This session is not active.'}, status=status.HTTP_400_BAD_REQUEST)

    session.revoked_at = timezone.now()
    session.revoked_by = request.user
    session.save(update_fields=['revoked_at', 'revoked_by'])
    log_admin_action(request, 'rbac.break_glass.revoke', target=session)
    return Response(BreakGlassSessionSerializer(session).data)


# ---------------------------------------------------------------------------
# Pending approvals (dual-authorization)
# ---------------------------------------------------------------------------

def _can_review(user, approval):
    mapping = ACTION_KEY_RESOURCE.get(approval.action_key)
    if not mapping:
        return has_permission(user, 'rbac_engine', 'execute')
    resource, action = mapping
    return has_permission(user, resource, action)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def pending_approvals_list(request):
    if not is_superadmin_staff(request.user):
        return Response({'error': 'Superadmin access required'}, status=status.HTTP_403_FORBIDDEN)

    qs = PendingApproval.objects.select_related('requested_by', 'decided_by')
    status_filter = request.query_params.get('status', 'pending')
    if status_filter and status_filter != 'all':
        qs = qs.filter(status=status_filter)

    visible = [a for a in qs if _can_review(request.user, a) or a.requested_by_id == request.user.id]
    return Response(PendingApprovalSerializer(visible, many=True).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def pending_approval_approve(request, pk):
    if not is_superadmin_staff(request.user):
        return Response({'error': 'Superadmin access required'}, status=status.HTTP_403_FORBIDDEN)

    approval = get_object_or_404(PendingApproval, pk=pk)
    if not _can_review(request.user, approval):
        return Response({'error': 'You do not hold the permission required to review this request.'}, status=status.HTTP_403_FORBIDDEN)

    try:
        approval = dual_auth.approve(approval, request.user)
    except PermissionError as e:
        return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
    except ValueError as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    log_admin_action(request, 'rbac.approval.approve', target=approval, reason=approval.request_reason)
    return Response(PendingApprovalSerializer(approval).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def pending_approval_reject(request, pk):
    if not is_superadmin_staff(request.user):
        return Response({'error': 'Superadmin access required'}, status=status.HTTP_403_FORBIDDEN)

    approval = get_object_or_404(PendingApproval, pk=pk)
    if not _can_review(request.user, approval):
        return Response({'error': 'You do not hold the permission required to review this request.'}, status=status.HTTP_403_FORBIDDEN)

    reason = str(request.data.get('reason', '')).strip()
    try:
        approval = dual_auth.reject(approval, request.user, reason)
    except PermissionError as e:
        return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
    except ValueError as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    log_admin_action(request, 'rbac.approval.reject', target=approval, reason=reason)
    return Response(PendingApprovalSerializer(approval).data)
