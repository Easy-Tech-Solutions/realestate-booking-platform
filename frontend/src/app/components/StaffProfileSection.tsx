import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { staffAPI } from '../../services/api/staff';
import type { StaffProfile, StaffEducation, StaffLegalRecord } from '../../services/api/staff';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Trash2, GraduationCap, ScrollText } from 'lucide-react';
import { getErrorMessage } from '../../services/api/shared/errors';

const RECORD_TYPE_LABELS: Record<StaffLegalRecord['record_type'], string> = {
  national_id: 'National ID',
  work_permit: 'Work Permit',
  contract: 'Employment Contract',
  certification: 'Professional Certification',
  other: 'Other',
};

function EducationEditor({ staff, onChange }: { staff: StaffProfile; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [institution, setInstitution] = useState('');
  const [degree, setDegree] = useState('');
  const [fieldOfStudy, setFieldOfStudy] = useState('');
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!institution.trim()) {
      toast.error('Institution is required.');
      return;
    }
    setBusy(true);
    try {
      await staffAPI.addEducation({
        institution: institution.trim(),
        degree: degree.trim(),
        field_of_study: fieldOfStudy.trim(),
        start_year: startYear ? parseInt(startYear, 10) : null,
        end_year: endYear ? parseInt(endYear, 10) : null,
      });
      setInstitution(''); setDegree(''); setFieldOfStudy(''); setStartYear(''); setEndYear('');
      setAdding(false);
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to add education entry'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: StaffEducation) => {
    try {
      await staffAPI.deleteEducation(entry.id);
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to remove entry'));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><GraduationCap className="h-4 w-4" /> Education</h3>
        {!adding && <Button size="sm" variant="outline" onClick={() => setAdding(true)}>Add</Button>}
      </div>
      {staff.education.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No education entries yet.</p>
      )}
      <div className="space-y-2">
        {staff.education.map((e) => (
          <div key={e.id} className="flex items-start justify-between border-b border-border/50 pb-2 text-sm">
            <div>
              <p className="font-medium">{e.institution}</p>
              <p className="text-xs text-muted-foreground">
                {[e.degree, e.field_of_study].filter(Boolean).join(' · ')}
                {(e.start_year || e.end_year) && ` · ${e.start_year ?? '?'}–${e.end_year ?? 'present'}`}
              </p>
            </div>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(e)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      {adding && (
        <div className="grid sm:grid-cols-2 gap-2 border border-border rounded-lg p-3">
          <Input placeholder="Institution" value={institution} onChange={(e) => setInstitution(e.target.value)} />
          <Input placeholder="Degree (e.g. BSc)" value={degree} onChange={(e) => setDegree(e.target.value)} />
          <Input placeholder="Field of study" value={fieldOfStudy} onChange={(e) => setFieldOfStudy(e.target.value)} />
          <div className="flex gap-2">
            <Input placeholder="Start year" value={startYear} onChange={(e) => setStartYear(e.target.value)} />
            <Input placeholder="End year" value={endYear} onChange={(e) => setEndYear(e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LegalRecordsEditor({ staff, onChange }: { staff: StaffProfile; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [recordType, setRecordType] = useState<StaffLegalRecord['record_type']>('national_id');
  const [title, setTitle] = useState('');
  const [issuingAuthority, setIssuingAuthority] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      toast.error('A title is required.');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('record_type', recordType);
      form.append('title', title.trim());
      if (issuingAuthority.trim()) form.append('issuing_authority', issuingAuthority.trim());
      if (documentNumber.trim()) form.append('document_number', documentNumber.trim());
      if (file) form.append('document', file);
      await staffAPI.addLegalRecord(form);
      setTitle(''); setIssuingAuthority(''); setDocumentNumber(''); setFile(null);
      setAdding(false);
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to add record'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: StaffLegalRecord) => {
    try {
      await staffAPI.deleteLegalRecord(entry.id);
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to remove record'));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><ScrollText className="h-4 w-4" /> Legal &amp; identification</h3>
        {!adding && <Button size="sm" variant="outline" onClick={() => setAdding(true)}>Add</Button>}
      </div>
      {staff.legal_records.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No legal records on file yet.</p>
      )}
      <div className="space-y-2">
        {staff.legal_records.map((r) => (
          <div key={r.id} className="flex items-start justify-between border-b border-border/50 pb-2 text-sm">
            <div>
              <p className="font-medium">{r.title} <Badge variant="outline" className="ml-1">{RECORD_TYPE_LABELS[r.record_type]}</Badge></p>
              <p className="text-xs text-muted-foreground">
                {[r.issuing_authority, r.document_number].filter(Boolean).join(' · ')}
              </p>
              {r.document_url && (
                <a href={r.document_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  View document
                </a>
              )}
            </div>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(r)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      {adding && (
        <div className="grid sm:grid-cols-2 gap-2 border border-border rounded-lg p-3">
          <Select value={recordType} onValueChange={(v) => setRecordType(v as StaffLegalRecord['record_type'])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(RECORD_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input placeholder="Issuing authority" value={issuingAuthority} onChange={(e) => setIssuingAuthority(e.target.value)} />
          <Input placeholder="Document number" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
          <div className="sm:col-span-2">
            <Label className="text-xs text-muted-foreground">Document (optional)</Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function StaffProfileSection() {
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const data = await staffAPI.me();
      setStaff(data);
      setBio(data.bio);
      setPhone(data.phone_number);
    } catch {
      setStaff(null);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { load(); }, []);

  const saveProfile = async () => {
    setBusy(true);
    try {
      await staffAPI.updateMe({ bio, phone_number: phone });
      toast.success('Profile updated.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update profile'));
    } finally {
      setBusy(false);
    }
  };

  // Not a staff account — render nothing rather than an error, since most
  // users simply aren't staff.
  if (!loaded || !staff) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Staff profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Position</p>
            <p className="font-medium">{staff.position || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Department</p>
            <p className="font-medium">{staff.department || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Hire date</p>
            <p className="font-medium">{staff.hire_date || '—'}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Position, department, and hire date are set by HR. You can update your bio and phone
          number, and add your own education and legal/identification records below.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Phone number</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Bio</Label>
          <Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
        <Button size="sm" disabled={busy} onClick={saveProfile}>{busy ? 'Saving…' : 'Save profile'}</Button>

        <EducationEditor staff={staff} onChange={load} />
        <LegalRecordsEditor staff={staff} onChange={load} />
      </CardContent>
    </Card>
  );
}
