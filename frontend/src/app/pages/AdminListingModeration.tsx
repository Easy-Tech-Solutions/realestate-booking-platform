import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Building2, Sparkles, RadioTower, ShieldAlert, Search, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { inventoryAPI } from '../../services/api/inventory';
import type { ListingFlag, InventoryListing } from '../../services/api/inventory';
import { propertiesAPI } from '../../services/api.service';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Checkbox } from '../components/ui/checkbox';
import { BulkActionBar } from '../components/BulkActionBar';
import { formatCurrency } from '../../core/utils';
import { getErrorMessage } from '../../services/api/shared/errors';

function AiScoreBadge({ score, rationale }: { score: number | null; rationale: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
      title={rationale || undefined}
    >
      <Sparkles className="h-3 w-3" /> {score === null ? 'AI content score: pending / disabled' : `AI content score: ${Math.round(score)}`}
    </span>
  );
}

const severityColor: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-600',
};

const statusColor: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending_review: 'bg-yellow-100 text-yellow-700',
  published: 'bg-primary/10 text-primary',
  rejected: 'bg-red-100 text-red-600',
  suspended: 'bg-orange-100 text-orange-700',
};

function ListingFlagCard({ flag, onDecided }: { flag: ListingFlag; onDecided: () => void }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'dismissed' | 'confirmed') => {
    setBusy(true);
    try {
      await inventoryAPI.reviewFlag(flag.id, decision, notes.trim());
      toast.success(decision === 'confirmed' ? 'Marked as confirmed violation.' : 'Dismissed.');
      onDecided();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to record decision'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">{flag.flag_type_display}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {flag.listing_title ? `"${flag.listing_title}"` : 'Listing no longer exists'}
            {flag.listing_status && ` · ${flag.listing_status}`}
          </p>
        </div>
        <Badge className={severityColor[flag.severity]}>{flag.severity}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <AiScoreBadge score={flag.ai_score} rationale={flag.ai_rationale} />
        <p className="text-sm whitespace-pre-wrap">{flag.details}</p>
        <Textarea
          placeholder="Review notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => decide('confirmed')}>Confirm violation</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decide('dismissed')}>Dismiss</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateManualFlagForm({ onCreated }: { onCreated: () => void }) {
  const [listingId, setListingId] = useState('');
  const [details, setDetails] = useState('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high'>('medium');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const id = Number(listingId);
    if (!id || !details.trim()) {
      toast.error('Listing ID and details are required.');
      return;
    }
    setBusy(true);
    try {
      await inventoryAPI.createManualFlag(id, details.trim(), severity);
      setListingId('');
      setDetails('');
      toast.success('Manual listing flag created.');
      onCreated();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create flag'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Create manual flag</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-[140px,1fr,140px] gap-2">
          <Input placeholder="Listing ID" value={listingId} onChange={(e) => setListingId(e.target.value)} />
          <Input placeholder="Details" value={details} onChange={(e) => setDetails(e.target.value)} />
          <Select value={severity} onValueChange={(v) => setSeverity(v as typeof severity)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" disabled={busy} onClick={create}>Create flag</Button>
      </CardContent>
    </Card>
  );
}

function SuspendDialog({ listing, onDone }: { listing: InventoryListing; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const suspend = async () => {
    if (!reason.trim()) {
      toast.error('A reason is required to suspend a listing.');
      return;
    }
    setBusy(true);
    try {
      await inventoryAPI.suspendListing(listing.id, reason.trim());
      toast.success('Listing suspended.');
      setOpen(false);
      setReason('');
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to suspend listing'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <Button size="sm" variant="outline" className="text-orange-600" onClick={() => setOpen(true)}>Suspend</Button>;
  }

  return (
    <div className="flex flex-col gap-2 min-w-[220px]">
      <Textarea placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={busy} onClick={suspend}>Confirm suspend</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function ComplianceDialog({ listing, onDone }: { listing: InventoryListing; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [regNumber, setRegNumber] = useState(listing.local_registration_number || '');
  const [cap, setCap] = useState(listing.occupancy_cap != null ? String(listing.occupancy_cap) : '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await inventoryAPI.updateCompliance(listing.id, {
        local_registration_number: regNumber.trim(),
        occupancy_cap: cap.trim() ? Number(cap) : null,
      });
      toast.success('Compliance data updated.');
      setOpen(false);
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update compliance data'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {listing.occupancy_cap != null || listing.local_registration_number ? 'Compliance ✓' : 'Compliance'}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-w-[220px]">
      <Input placeholder="Registration number" value={regNumber} onChange={(e) => setRegNumber(e.target.value)} />
      <Input
        placeholder={`Occupancy cap (currently max_guests-unbound)`}
        value={cap}
        onChange={(e) => setCap(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Current max_guests: {listing.max_guests}. The cap can't be set below it — lower max_guests first.
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={save}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function AdminBulkListingsSection() {
  const [ownerId, setOwnerId] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTemplate = async () => {
    try {
      downloadBlob(await propertiesAPI.bulkDownloadTemplate(), 'homekonet-listings-template.xlsx');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to download template'));
    }
  };

  const handleExport = async () => {
    try {
      downloadBlob(await propertiesAPI.bulkExport(ownerId.trim() || undefined), 'homekonet-listings-export.xlsx');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to export listings'));
    }
  };

  const handleImportFile = async (file: File) => {
    setImporting(true);
    try {
      const result = await propertiesAPI.bulkImport(file);
      if (result.row_errors.length === 0) {
        toast.success(`${result.created_count} listing(s) imported.`);
      } else {
        toast.warning(
          `${result.created_count} listing(s) imported, ${result.row_errors.length} row(s) failed — ` +
          result.row_errors.slice(0, 3).map((e) => `row ${e.row}: ${JSON.stringify(e.errors)}`).join('; ')
        );
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'Import failed'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2"><Upload className="h-4 w-4" /> Bulk import/export</h2>
      <p className="text-xs text-muted-foreground max-w-2xl">
        Import/export any owner's listings via XLSX (requires users.staff_management or full admin —
        see listings/bulk.py for the exact format). Imported listings land as Pending Review, same as
        one created through the normal wizard — no photos, no shortcut around ownership verification.
      </p>
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Owner ID (export only, blank = everyone)</label>
            <Input className="w-40" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder="e.g. 42" />
          </div>
          <Button variant="outline" size="sm" onClick={handleTemplate}>
            <Download className="h-3.5 w-3.5 mr-1" /> Template
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-3.5 w-3.5 mr-1" /> Export
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = '';
            }}
          />
          <Button variant="outline" size="sm" disabled={importing} onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1" /> {importing ? 'Importing…' : 'Import (with owner_email column)'}
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}

export function AdminListingModeration() {
  const navigate = useNavigate();

  const [flags, setFlags] = useState<ListingFlag[]>([]);
  const [flagsStatusFilter, setFlagsStatusFilter] = useState<'open' | 'dismissed' | 'confirmed' | 'all'>('open');
  const [flagsLoading, setFlagsLoading] = useState(true);
  const [flagsError, setFlagsError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const [listings, setListings] = useState<InventoryListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [listingsCount, setListingsCount] = useState(0);
  const PAGE_SIZE = 25;

  const loadFlags = async (status = flagsStatusFilter) => {
    setFlagsLoading(true);
    try {
      setFlags(await inventoryAPI.listFlags(status));
      setFlagsError(null);
    } catch (err) {
      setFlagsError(getErrorMessage(err, 'You do not have Inventory & Listings access.'));
    } finally {
      setFlagsLoading(false);
    }
  };

  const loadListings = async (targetPage = page) => {
    setListingsLoading(true);
    try {
      const result = await inventoryAPI.searchListings({
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: search.trim() || undefined,
        flaggedOnly,
        page: targetPage,
      });
      setListings(result.results);
      setListingsCount(result.count);
      setListingsError(null);
    } catch (err) {
      setListingsError(getErrorMessage(err, 'You do not have Inventory & Listings access.'));
    } finally {
      setListingsLoading(false);
    }
  };

  useEffect(() => { loadFlags(flagsStatusFilter); }, [flagsStatusFilter]);
  useEffect(() => { setPage(1); setSelected(new Set()); loadListings(1); }, [statusFilter, flaggedOnly]);

  const goToPage = (p: number) => {
    setPage(p);
    setSelected(new Set());
    loadListings(p);
  };

  const totalPages = Math.max(1, Math.ceil(listingsCount / PAGE_SIZE));

  const runScan = async () => {
    setScanning(true);
    try {
      const result = await inventoryAPI.scanForFlags();
      toast.success(`Scan complete — ${result.created} new flag(s) created.`);
      loadFlags();
      loadListings();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Scan failed'));
    } finally {
      setScanning(false);
    }
  };

  const unsuspend = async (listing: InventoryListing) => {
    try {
      await inventoryAPI.unsuspendListing(listing.id);
      toast.success('Listing restored to published.');
      loadListings();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to unsuspend'));
    }
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === listings.length ? new Set() : new Set(listings.map((l) => l.id))));
  };

  const bulkUnsuspend = async () => {
    setBulkBusy(true);
    try {
      const result = await inventoryAPI.bulkAction({ action: 'unsuspend', listing_ids: [...selected] });
      toast.success(`${result.succeeded.length} restored, ${result.failed.length} failed.`);
      setSelected(new Set());
      loadListings();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Bulk unsuspend failed'));
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkSuspend = async () => {
    if (!bulkReason.trim()) {
      toast.error('A reason is required to suspend listings.');
      return;
    }
    setBulkBusy(true);
    try {
      const result = await inventoryAPI.bulkAction({ action: 'suspend', listing_ids: [...selected], reason: bulkReason.trim() });
      toast.success(`${result.succeeded.length} suspended, ${result.failed.length} failed.`);
      setBulkReason('');
      setSelected(new Set());
      loadListings();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Bulk suspend failed'));
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Building2 className="h-5 w-5" /> Inventory & Listing Moderation</h1>
      </div>

      <AdminBulkListingsSection />

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Listing flags</h2>
          <div className="flex items-center gap-2">
            <Select value={flagsStatusFilter} onValueChange={(v) => setFlagsStatusFilter(v as typeof flagsStatusFilter)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={scanning} onClick={runScan}>
              <RadioTower className="h-3.5 w-3.5 mr-1" /> {scanning ? 'Scanning…' : 'Run detectors'}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Flags come from rule-based detectors (possible duplicate listings at the same location, prices far
          outside the norm for a city/property type). Each flag is then scored by a local AI model
          reading the listing's title/description/price/amenities and the detector evidence — not the
          listing photos.
        </p>
        {flagsLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : flagsError ? (
          <p className="text-sm text-muted-foreground">{flagsError}</p>
        ) : flags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No flags in this status.</p>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            {flags.map((f) => <ListingFlagCard key={f.id} flag={f} onDecided={() => loadFlags()} />)}
          </div>
        )}
        <CreateManualFlagForm onCreated={() => loadFlags()} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Global inventory search</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Title, address, city, host…"
              className="pl-10 w-64"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') goToPage(1); }}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => goToPage(1)}>Search</Button>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending_review">Pending Review</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
            Flagged only
          </label>
        </div>

        <BulkActionBar selectedCount={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={bulkUnsuspend}>Restore selected</Button>
          <Input
            placeholder="Suspension reason"
            className="w-48 h-8"
            value={bulkReason}
            onChange={(e) => setBulkReason(e.target.value)}
          />
          <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={bulkSuspend}>Suspend selected</Button>
        </BulkActionBar>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={listings.length > 0 && selected.size === listings.length}
                        onCheckedChange={toggleAll}
                        title="Select all on this page"
                      />
                    </TableHead>
                    <TableHead>Listing</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listingsLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                  ) : listingsError ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">{listingsError}</TableCell></TableRow>
                  ) : listings.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No listings match.</TableCell></TableRow>
                  ) : (
                    listings.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>
                          <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggleOne(l.id)} />
                        </TableCell>
                        <TableCell>
                          <p className="font-medium truncate max-w-[220px]">{l.title}</p>
                          <p className="text-xs text-muted-foreground">{l.city}{l.city && l.country ? ', ' : ''}{l.country}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm">{l.owner_username}</p>
                          <p className="text-xs text-muted-foreground">{l.owner_email}</p>
                        </TableCell>
                        <TableCell>{formatCurrency(Number(l.price))}</TableCell>
                        <TableCell>
                          <Badge className={statusColor[l.status] || ''}>{l.status}</Badge>
                          {l.status === 'suspended' && l.suspension_reason && (
                            <p className="text-xs text-muted-foreground mt-1 max-w-[160px] truncate" title={l.suspension_reason}>{l.suspension_reason}</p>
                          )}
                        </TableCell>
                        <TableCell>{l.open_flag_count > 0 ? <Badge variant="destructive">{l.open_flag_count}</Badge> : '—'}</TableCell>
                        <TableCell className="space-x-2">
                          {l.status === 'suspended' ? (
                            <Button size="sm" variant="outline" onClick={() => unsuspend(l)}>Restore</Button>
                          ) : (
                            <SuspendDialog listing={l} onDone={loadListings} />
                          )}
                          <ComplianceDialog listing={l} onDone={loadListings} />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {listingsCount > 0 && (
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border">
                <p className="text-sm text-muted-foreground">
                  {listingsCount} listing{listingsCount === 1 ? '' : 's'} · page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={listingsLoading || page <= 1} onClick={() => goToPage(page - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="outline" disabled={listingsLoading || page >= totalPages} onClick={() => goToPage(page + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
