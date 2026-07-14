import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, KeySquare, Trash2, Plus, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { rbacAPI } from '../../services/api/rbac';
import type { Role, ResourceNode, ActionOption, UserRoleAssignment } from '../../services/api/rbac';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { getErrorMessage } from '../../services/api/shared/errors';

function CreateRoleForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !slug.trim()) {
      toast.error('Name and slug are required.');
      return;
    }
    setBusy(true);
    try {
      await rbacAPI.createRole({ name: name.trim(), slug: slug.trim(), description: description.trim() });
      setName(''); setSlug(''); setDescription('');
      toast.success('Role created.');
      onCreated();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create role'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Create custom role</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-2">
          <Input placeholder="Name (e.g. Regional Compliance Lead)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Slug (e.g. regional_compliance_lead)" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </div>
        <Textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        <Button size="sm" disabled={busy} onClick={submit}><Plus className="h-3.5 w-3.5 mr-1" /> Create role</Button>
      </CardContent>
    </Card>
  );
}

function RolePermissionEditor({
  role, resources, actions, onChanged,
}: { role: Role; resources: ResourceNode[]; actions: ActionOption[]; onChanged: () => void }) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const grantFor = (resource: string, action: string) =>
    role.permissions.find((p) => p.resource === resource && p.action === action);

  const toggle = async (resource: string, action: string) => {
    const key = `${resource}.${action}`;
    setBusyKey(key);
    try {
      const existing = grantFor(resource, action);
      if (existing) {
        await rbacAPI.removePermission(role.id, existing.id);
      } else {
        await rbacAPI.addPermission(role.id, resource, action);
      }
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update permission'));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-1.5 pr-2 font-medium">Resource</th>
            {actions.map((a) => <th key={a.value} className="text-center py-1.5 px-2 font-medium">{a.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r.path} className="border-b border-border/50">
              <td className="py-1.5 pr-2">
                <span className={r.path.includes('.') ? 'pl-4 text-muted-foreground' : 'font-medium'}>{r.label}</span>
                {!r.wired && <span className="ml-1.5 text-[10px] text-muted-foreground">(placeholder)</span>}
              </td>
              {actions.map((a) => {
                const key = `${r.path}.${a.value}`;
                const granted = Boolean(grantFor(r.path, a.value));
                return (
                  <td key={a.value} className="text-center py-1.5 px-2">
                    <input
                      type="checkbox"
                      checked={granted}
                      disabled={busyKey === key}
                      onChange={() => toggle(r.path, a.value)}
                      title={`${r.label} — ${a.label}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssignRolePanel({ roles }: { roles: Role[] }) {
  const [userId, setUserId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [assignments, setAssignments] = useState<UserRoleAssignment[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!userId.trim()) { setAssignments([]); return; }
    try {
      setAssignments(await rbacAPI.listUserRoles(Number(userId)));
    } catch {
      setAssignments([]);
    }
  };

  const assign = async () => {
    if (!userId.trim() || !roleId) {
      toast.error('User ID and role are required.');
      return;
    }
    setBusy(true);
    try {
      await rbacAPI.assignRole(Number(userId), Number(roleId));
      toast.success('Role assigned. The user is now marked is_staff if they weren\'t already.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to assign role'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (assignmentId: number) => {
    try {
      await rbacAPI.revokeRole(assignmentId);
      toast.success('Role revoked.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to revoke role'));
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Assign a role to a user</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input placeholder="User ID" className="w-28" value={userId} onChange={(e) => setUserId(e.target.value)} onBlur={load} />
          <select className="text-sm border border-border rounded-lg px-2 bg-background" value={roleId} onChange={(e) => setRoleId(e.target.value)} title="Role">
            <option value="">Select a role…</option>
            {roles.filter((r) => r.slug !== 'superadmin').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <Button size="sm" disabled={busy} onClick={assign}>Assign</Button>
          <Button size="sm" variant="outline" onClick={load}>Look up user's roles</Button>
        </div>
        {assignments.length > 0 && (
          <div className="space-y-1.5">
            {assignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm">
                <span>{a.username} — {a.role_name}</span>
                <Button size="icon" variant="ghost" onClick={() => revoke(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminRoles() {
  const navigate = useNavigate();
  const [roles, setRoles] = useState<Role[]>([]);
  const [resources, setResources] = useState<ResourceNode[]>([]);
  const [actions, setActions] = useState<ActionOption[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [rolesRes, treeRes] = await Promise.all([rbacAPI.listRoles(), rbacAPI.resourceTree()]);
      setRoles(rolesRes);
      setResources(treeRes.resources);
      setActions(treeRes.actions);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have RBAC Engine access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const selectedRole = useMemo(() => roles.find((r) => r.id === selectedRoleId) || null, [roles, selectedRoleId]);

  const deleteRole = async (role: Role) => {
    try {
      await rbacAPI.deleteRole(role.id);
      toast.success('Role deleted.');
      setSelectedRoleId(null);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete role'));
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><KeySquare className="h-5 w-5" /> Roles & Permissions</h1>
      </div>

      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : (
        <>
          <CreateRoleForm onCreated={load} />

          <div className="grid lg:grid-cols-[280px,1fr] gap-6">
            <Card>
              <CardHeader><CardTitle>Roles</CardTitle></CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <p className="text-sm text-muted-foreground p-4">Loading…</p>
                ) : (
                  <div className="space-y-1 p-2">
                    {roles.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelectedRoleId(r.id)}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between gap-2 ${selectedRoleId === r.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          {r.is_preset && <Lock className="h-3 w-3 shrink-0" />}
                          {r.name}
                        </span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{r.assignee_count}</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              {selectedRole ? (
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {selectedRole.name}
                        {selectedRole.is_preset && <Badge variant="outline">preset — backs a legacy department</Badge>}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">{selectedRole.description}</p>
                    </div>
                    {!selectedRole.is_preset && (
                      <Button size="sm" variant="outline" className="text-destructive shrink-0" onClick={() => deleteRole(selectedRole)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete role
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    <RolePermissionEditor role={selectedRole} resources={resources} actions={actions} onChanged={load} />
                  </CardContent>
                </Card>
              ) : (
                <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Select a role to view or edit its permissions.</CardContent></Card>
              )}

              <AssignRolePanel roles={roles} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
