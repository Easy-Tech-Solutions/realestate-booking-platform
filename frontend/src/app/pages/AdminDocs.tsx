import { useEffect, useRef, useState } from 'react';
import { platformOpsAPI, type DocSlug } from '../../services/api/platformops';
import { getErrorMessage } from '../../services/api/shared/errors';

const DOCS: { slug: DocSlug; label: string; icon: string }[] = [
  { slug: 'user-guide', label: 'User Guide', icon: '👤' },
  { slug: 'management-portal-guide', label: 'Management Portal', icon: '🛡️' },
  { slug: 'developer-guide', label: 'Developer Guide', icon: '⚙️' },
];

export function AdminDocs() {
  const [active, setActive] = useState<DocSlug>('user-guide');
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // The docs view requires staff auth via JWT bearer token — a plain
    // <iframe src="..."> load can't carry that header, so we fetch the HTML
    // ourselves (with auth) and hand the iframe the content directly via
    // srcdoc instead of pointing it at the URL.
    platformOpsAPI
      .getDocs(active)
      .then((text) => { if (!cancelled) setHtml(text); })
      .catch((err) => { if (!cancelled) setError(getErrorMessage(err, 'Failed to load this guide.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const openInNewTab = () => {
    if (!html) return;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Tab bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-card shrink-0 flex-wrap">
        <span className="text-sm font-semibold text-muted-foreground mr-2">Documentation</span>
        {DOCS.map((doc) => (
          <button
            key={doc.slug}
            onClick={() => setActive(doc.slug)}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
              active === doc.slug
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            ].join(' ')}
          >
            <span>{doc.icon}</span>
            {doc.label}
          </button>
        ))}
        <button
          type="button"
          onClick={openInNewTab}
          disabled={!html}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"
        >
          Open in new tab ↗
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-sm text-destructive">{error}</div>
      ) : (
        <iframe
          key={active}
          srcDoc={html}
          title={DOCS.find((d) => d.slug === active)?.label}
          className="flex-1 w-full border-0"
          sandbox="allow-same-origin allow-scripts allow-popups"
        />
      )}
    </div>
  );
}
