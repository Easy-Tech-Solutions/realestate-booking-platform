import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Pencil, Trash2, Search } from 'lucide-react';
import { genericAdminAPI } from '../../../services/api/genericAdmin';
import { getErrorMessage } from '../../../services/api/shared/errors';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { Checkbox } from '../../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { BulkActionBar } from '../../components/BulkActionBar';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { FieldConfig, GenericAdminConfig } from './types';

const PAGE_SIZE = 25;

function formatCellValue(field: FieldConfig, value: unknown) {
  if (field.type === 'boolean') {
    return <Badge variant={value ? 'secondary' : 'outline'}>{value ? 'Yes' : 'No'}</Badge>;
  }
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">—</span>;
  if (field.type === 'datetime' && typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    }
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

interface RecordFormProps<T extends { id: number }> {
  config: GenericAdminConfig<T>;
  open: boolean;
  row: T | null; // null => create mode
  onClose: () => void;
  onSaved: () => void;
}

function RecordFormDialog<T extends { id: number }>({ config, open, row, onClose, onSaved }: RecordFormProps<T>) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const isEdit = row !== null;

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, unknown> = {};
    config.fields.forEach((f) => {
      initial[f.key] = row ? (row as Record<string, unknown>)[f.key] : (f.type === 'boolean' ? false : '');
    });
    setValues(initial);
  }, [open, row, config.fields]);

  const setField = (key: string, value: unknown) => setValues((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    const payload: Record<string, unknown> = {};
    config.fields.forEach((f) => {
      if (f.type === 'readonly' || f.showInForm === false) return;
      if (f.required && (values[f.key] === '' || values[f.key] === undefined || values[f.key] === null)) return;
      payload[f.key] = values[f.key];
    });
    const missingRequired = config.fields.find(
      (f) => f.required && f.type !== 'readonly' && f.showInForm !== false &&
        (values[f.key] === '' || values[f.key] === undefined || values[f.key] === null)
    );
    if (missingRequired) {
      toast.error(`${missingRequired.label} is required.`);
      return;
    }

    setBusy(true);
    try {
      if (isEdit) {
        await genericAdminAPI.update(config.modelKey, row!.id, payload);
        toast.success(`${config.title.replace(/s$/, '')} updated.`);
      } else {
        await genericAdminAPI.create(config.modelKey, payload);
        toast.success(`${config.title.replace(/s$/, '')} created.`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, isEdit ? 'Could not save changes.' : 'Could not create record.'));
    } finally {
      setBusy(false);
    }
  };

  const formFields = config.fields.filter((f) => f.showInForm !== false && (isEdit || f.type !== 'readonly'));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${config.title.replace(/s$/, '')}` : `New ${config.title.replace(/s$/, '')}`}</DialogTitle>
          {config.description && <DialogDescription>{config.description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {formFields.map((f) => (
            <div key={f.key} className="space-y-1">
              <label className="text-sm font-medium">{f.label}{f.required && ' *'}</label>
              {f.type === 'readonly' ? (
                <Input value={String(values[f.key] ?? '')} disabled />
              ) : f.type === 'boolean' ? (
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox checked={Boolean(values[f.key])} onCheckedChange={(v) => setField(f.key, Boolean(v))} />
                  <span className="text-sm text-muted-foreground">{f.helpText || (values[f.key] ? 'Enabled' : 'Disabled')}</span>
                </div>
              ) : f.type === 'select' ? (
                <Select value={String(values[f.key] ?? '')} onValueChange={(v) => setField(f.key, v)}>
                  <SelectTrigger><SelectValue placeholder={f.placeholder} /></SelectTrigger>
                  <SelectContent>
                    {(f.options || []).map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === 'textarea' ? (
                <Textarea
                  value={String(values[f.key] ?? '')}
                  placeholder={f.placeholder}
                  onChange={(e) => setField(f.key, e.target.value)}
                  rows={3}
                />
              ) : (
                <Input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={String(values[f.key] ?? '')}
                  placeholder={f.placeholder}
                  onChange={(e) => setField(f.key, f.type === 'number' ? e.target.valueAsNumber : e.target.value)}
                />
              )}
              {f.helpText && f.type !== 'boolean' && <p className="text-xs text-muted-foreground">{f.helpText}</p>}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={handleSubmit}>{isEdit ? 'Save changes' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GenericAdminPage<T extends { id: number }>({ config }: { config: GenericAdminConfig<T> }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<T[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<T | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await genericAdminAPI.list<T>(config.modelKey, {
        search: search.trim() || undefined,
        ordering: config.defaultOrdering,
        page,
        page_size: PAGE_SIZE,
      });
      setRows(resp.results);
      setCount(resp.count);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, `You do not have ${config.title} access.`));
    } finally {
      setLoading(false);
    }
  }, [config.modelKey, config.defaultOrdering, config.title, search, page]);

  useEffect(() => { load(); }, [page]);

  const tableFields = config.fields.filter((f) => f.showInTable !== false);
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  const clearSelection = () => setSelected(new Set());

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      await genericAdminAPI.remove(config.modelKey, deleteTarget.id);
      toast.success('Deleted.');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not delete.'));
    } finally {
      setBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ids = [...selected];
      const results = await Promise.allSettled(ids.map((id) => genericAdminAPI.remove(config.modelKey, id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      toast.success(`${ids.length - failed} deleted, ${failed} failed.`);
      setBulkDeleteOpen(false);
      clearSelection();
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold">{config.title}</h1>
      </div>
      {config.description && <p className="text-sm text-muted-foreground">{config.description}</p>}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder={config.searchPlaceholder || 'Search…'}
              className="pl-10 w-64"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(); } }}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => { setPage(1); load(); }}>Search</Button>
        </div>
        {!config.readOnly && (
          <Button size="sm" onClick={() => { setEditingRow(null); setFormOpen(true); }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New
          </Button>
        )}
      </div>

      {!config.readOnly && (
        <BulkActionBar selectedCount={selected.size} onClear={clearSelection}>
          <Button size="sm" variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete selected
          </Button>
        </BulkActionBar>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {!config.readOnly && (
                    <TableHead className="w-10">
                      <Checkbox checked={rows.length > 0 && selected.size === rows.length} onCheckedChange={toggleAll} />
                    </TableHead>
                  )}
                  {tableFields.map((f) => <TableHead key={f.key}>{f.label}</TableHead>)}
                  {!config.readOnly && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => { const colCount = tableFields.length + (config.readOnly ? 0 : 2); return loading ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={i}>
                      {[...Array(colCount)].map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : error ? (
                  <TableRow><TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">{error}</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">No records match.</TableCell></TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      {!config.readOnly && (
                        <TableCell>
                          <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggleOne(row.id)} />
                        </TableCell>
                      )}
                      {tableFields.map((f) => (
                        <TableCell key={f.key}>
                          {f.renderCell ? f.renderCell(row) : formatCellValue(f, (row as Record<string, unknown>)[f.key])}
                        </TableCell>
                      ))}
                      {!config.readOnly && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => { setEditingRow(row); setFormOpen(true); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(row)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                ); })()}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {!loading && !error && count > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{count} record{count === 1 ? '' : 's'} · page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <RecordFormDialog config={config} open={formOpen} row={editingRow} onClose={() => setFormOpen(false)} onSaved={load} />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this record?"
        description={deleteTarget && config.confirmDeleteLabel ? config.confirmDeleteLabel(deleteTarget) : 'This cannot be undone.'}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={`Delete ${selected.size} record(s)?`}
        description="This cannot be undone."
        confirmLabel="Delete selected"
        destructive
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteOpen(false)}
      />
    </div>
  );
}
