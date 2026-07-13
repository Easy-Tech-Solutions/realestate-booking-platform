"""
Generic dual-authorization (four-eyes) mechanism.

A view that wants two-admin sign-off for some actions registers an executor
function under an `action_key`, then calls `submit_or_execute()` with a
`requires_dual_auth` predicate it computes from its own business logic (an
amount threshold, a listing count, whatever is real for that action). If the
predicate is True, the action is deferred as a PendingApproval instead of
running immediately; a *different* admin must approve it before the executor
actually runs.
"""

EXECUTORS = {}


def register_executor(action_key):
    def decorator(fn):
        EXECUTORS[action_key] = fn
        return fn
    return decorator


def submit_or_execute(action_key, payload, requested_by, reason, requires_dual_auth):
    """Returns (result, approval) — exactly one is None. `result` is whatever
    the executor returned (dict) if it ran immediately; `approval` is the
    PendingApproval row if execution was deferred."""
    from .models import PendingApproval

    if requires_dual_auth:
        approval = PendingApproval.objects.create(
            action_key=action_key, payload=payload, requested_by=requested_by, request_reason=reason,
        )
        return None, approval

    fn = EXECUTORS[action_key]
    result = fn(payload)
    return result, None


def approve(approval, approved_by):
    if approval.requested_by_id == approved_by.id:
        raise PermissionError('A different admin must approve this action than the one who requested it.')
    if approval.status != 'pending':
        raise ValueError('This request has already been decided.')

    from django.utils import timezone
    fn = EXECUTORS.get(approval.action_key)
    if fn is None:
        raise ValueError(f'No executor registered for "{approval.action_key}".')

    try:
        result = fn(approval.payload)
        approval.execution_result = result if isinstance(result, dict) else {'result': str(result)}
        approval.status = 'approved'
    except Exception as e:
        approval.execution_error = str(e)
        approval.status = 'rejected'
        approval.decision_reason = f'Execution failed: {e}'

    approval.decided_by = approved_by
    approval.decided_at = timezone.now()
    approval.save()
    return approval


def reject(approval, rejected_by, reason=''):
    if approval.requested_by_id == rejected_by.id:
        raise PermissionError('A different admin must review this request than the one who submitted it.')
    if approval.status != 'pending':
        raise ValueError('This request has already been decided.')

    from django.utils import timezone
    approval.status = 'rejected'
    approval.decided_by = rejected_by
    approval.decision_reason = reason
    approval.decided_at = timezone.now()
    approval.save()
    return approval
