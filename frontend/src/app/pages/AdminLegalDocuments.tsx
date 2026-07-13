import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ScrollText, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { legalDocumentsAPI } from '../../services/api/legalDocuments';
import type { LegalDocument, LegalDocumentSection } from '../../services/api/legalDocuments';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { getErrorMessage } from '../../services/api/shared/errors';

const DOCUMENT_KEYS = [
  { value: 'terms_of_service', label: 'Terms of Service' },
  { value: 'privacy_policy', label: 'Privacy Policy' },
];

const EXAMPLE_SECTIONS = JSON.stringify(
  [{ title: '1. Example Section', intro: 'Optional intro line', content: ['A bullet point', 'Another bullet point'], outro: 'Optional closing line' }],
  null, 2,
);

export function AdminLegalDocuments() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<LegalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [documentKey, setDocumentKey] = useState('terms_of_service');
  const [version, setVersion] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [summary, setSummary] = useState('');
  const [sectionsJson, setSectionsJson] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setDocs(await legalDocumentsAPI.adminList());
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have Finance & Legal access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Pre-fill the editor with the current version's content when switching
  // documents, so publishing a new version means editing what's already
  // there rather than starting from a blank slate.
  useEffect(() => {
    const current = docs.find((d) => d.document_key === documentKey);
    setSectionsJson(JSON.stringify(current?.body_sections ?? [], null, 2));
  }, [documentKey, docs]);

  const publish = async () => {
    if (!version.trim() || !effectiveDate) {
      toast.error('Version and effective date are required.');
      return;
    }
    let bodySections: LegalDocumentSection[];
    try {
      bodySections = JSON.parse(sectionsJson || '[]');
      if (!Array.isArray(bodySections)) throw new Error('not an array');
    } catch {
      toast.error('Content must be valid JSON — an array of sections.');
      return;
    }
    setBusy(true);
    try {
      await legalDocumentsAPI.adminPublish({
        document_key: documentKey, version: version.trim(),
        effective_date: effectiveDate, summary_of_changes: summary.trim(),
        body_sections: bodySections,
      });
      toast.success('New version published — live immediately on the public Terms/Privacy pages.');
      setVersion(''); setEffectiveDate(''); setSummary('');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to publish version'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/management/finance')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><ScrollText className="h-5 w-5" /> Legal Documents</h1>
      </div>

      <p className="text-sm text-muted-foreground max-w-2xl">
        Publishing a new version here updates the actual content shown on the public Terms of Service /
        Privacy Policy pages immediately, and keeps a full history of every prior version and why it changed.
      </p>

      <Card>
        <CardHeader><CardTitle>Publish a new version</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Select value={documentKey} onValueChange={setDocumentKey}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_KEYS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Version (e.g. 2026-07-12)" value={version} onChange={(e) => setVersion(e.target.value)} />
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>
          <Textarea placeholder="Summary of changes" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
          <div className="space-y-1">
            <label className="text-sm font-medium">
              Content — JSON array of sections: <code className="text-xs text-muted-foreground">{'{ title, intro?, content: string | string[], outro? }'}</code>
            </label>
            <Textarea
              className="font-mono text-xs"
              rows={16}
              value={sectionsJson}
              onChange={(e) => setSectionsJson(e.target.value)}
              placeholder={EXAMPLE_SECTIONS}
            />
          </div>
          <Button disabled={busy} onClick={publish}>Publish version</Button>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Version history</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No versions recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {docs.map((d) => (
              <Card key={d.id}>
                <CardContent className="p-4 space-y-1">
                  <button type="button" className="w-full flex items-center justify-between gap-2 text-left" onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{d.document_key_display}</Badge>
                      <span className="font-medium text-sm">{d.version}</span>
                      <span className="text-xs text-muted-foreground">effective {d.effective_date}</span>
                    </div>
                    {expandedId === d.id ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  </button>
                  {d.summary_of_changes && <p className="text-sm text-muted-foreground">{d.summary_of_changes}</p>}
                  <p className="text-xs text-muted-foreground">Recorded by {d.published_by_username || 'system'} · {new Date(d.created_at).toLocaleString()}</p>
                  {expandedId === d.id && (
                    <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs">{JSON.stringify(d.body_sections, null, 2)}</pre>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
