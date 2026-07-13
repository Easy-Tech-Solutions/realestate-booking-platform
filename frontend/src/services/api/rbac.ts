import { fetchWithAuth } from './shared/client';

export interface ResourceNode {
  path: string;
  label: string;
  wired: boolean;
  note: string;
}

export interface ActionOption {
  value: string;
  label: string;
}

export interface RolePermission {
  id: number;
  resource: string;
  action: string;
}

export interface Role {
  id: number;
  name: string;
  slug: string;
  description: string;
  is_preset: boolean;
  created_by: number | null;
  created_by_username: string | null;
  permissions: RolePermission[];
  assignee_count: number;
  created_at: string;
  updated_at: string;
}

export interface UserRoleAssignment {
  id: number;
  user: number;
  username: string;
  role: number;
  role_name: string;
  role_slug: string;
  granted_by: number | null;
  granted_by_username: string | null;
  granted_at: string;
}

export interface BreakGlassSession {
  id: number;
  user: number;
  username: string;
  reason: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: number | null;
  revoked_by_username: string | null;
  is_active: boolean;
}

export interface PendingApproval {
  id: number;
  action_key: string;
  payload: Record<string, unknown>;
  request_reason: string;
  requested_by: number;
  requested_by_username: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: number | null;
  decided_by_username: string | null;
  decision_reason: string;
  decided_at: string | null;
  execution_result: Record<string, unknown> | null;
  execution_error: string;
  created_at: string;
}

export const rbacAPI = {
  resourceTree: async (): Promise<{ resources: ResourceNode[]; actions: ActionOption[] }> => {
    return fetchWithAuth('/api/rbac/resource-tree/');
  },

  myPermissions: async (): Promise<{ grants: { resource: string; action: string }[] }> => {
    return fetchWithAuth('/api/rbac/my-permissions/');
  },

  listRoles: async (): Promise<Role[]> => {
    return fetchWithAuth<Role[]>('/api/rbac/roles/');
  },

  createRole: async (payload: { name: string; slug: string; description?: string }): Promise<Role> => {
    return fetchWithAuth<Role>('/api/rbac/roles/', { method: 'POST', body: JSON.stringify(payload) });
  },

  updateRole: async (id: number, payload: Partial<{ name: string; description: string }>): Promise<Role> => {
    return fetchWithAuth<Role>(`/api/rbac/roles/${id}/`, { method: 'PATCH', body: JSON.stringify(payload) });
  },

  deleteRole: async (id: number): Promise<void> => {
    await fetchWithAuth<void>(`/api/rbac/roles/${id}/`, { method: 'DELETE' });
  },

  addPermission: async (roleId: number, resource: string, action: string): Promise<RolePermission> => {
    return fetchWithAuth<RolePermission>(`/api/rbac/roles/${roleId}/permissions/`, {
      method: 'POST',
      body: JSON.stringify({ resource, action }),
    });
  },

  removePermission: async (roleId: number, permId: number): Promise<void> => {
    await fetchWithAuth<void>(`/api/rbac/roles/${roleId}/permissions/${permId}/`, { method: 'DELETE' });
  },

  listUserRoles: async (userId?: number): Promise<UserRoleAssignment[]> => {
    const qs = userId ? `?user_id=${userId}` : '';
    return fetchWithAuth<UserRoleAssignment[]>(`/api/rbac/user-roles/${qs}`);
  },

  assignRole: async (userId: number, roleId: number): Promise<UserRoleAssignment> => {
    return fetchWithAuth<UserRoleAssignment>('/api/rbac/user-roles/', {
      method: 'POST',
      body: JSON.stringify({ user: userId, role: roleId }),
    });
  },

  revokeRole: async (assignmentId: number): Promise<void> => {
    await fetchWithAuth<void>(`/api/rbac/user-roles/${assignmentId}/`, { method: 'DELETE' });
  },

  listBreakGlass: async (): Promise<BreakGlassSession[]> => {
    return fetchWithAuth<BreakGlassSession[]>('/api/rbac/break-glass/');
  },

  requestBreakGlass: async (reason: string, hours = 2): Promise<BreakGlassSession> => {
    return fetchWithAuth<BreakGlassSession>('/api/rbac/break-glass/', {
      method: 'POST',
      body: JSON.stringify({ reason, hours }),
    });
  },

  revokeBreakGlass: async (id: number): Promise<BreakGlassSession> => {
    return fetchWithAuth<BreakGlassSession>(`/api/rbac/break-glass/${id}/revoke/`, { method: 'POST' });
  },

  listApprovals: async (statusFilter = 'pending'): Promise<PendingApproval[]> => {
    return fetchWithAuth<PendingApproval[]>(`/api/rbac/approvals/?status=${statusFilter}`);
  },

  approveRequest: async (id: number): Promise<PendingApproval> => {
    return fetchWithAuth<PendingApproval>(`/api/rbac/approvals/${id}/approve/`, { method: 'POST' });
  },

  rejectRequest: async (id: number, reason = ''): Promise<PendingApproval> => {
    return fetchWithAuth<PendingApproval>(`/api/rbac/approvals/${id}/reject/`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
};
