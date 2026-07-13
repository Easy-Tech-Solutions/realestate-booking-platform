import React, { useEffect, useState } from 'react';
import { legalDocumentsAPI } from '../../services/api/legalDocuments';
import type { LegalDocumentSection as Section } from '../../services/api/legalDocuments';

// Fallback only — shown if the legal-documents API is unreachable so the
// page never renders blank. The DB-backed version (editable via
// Management > Roles & Permissions... > Legal Documents) is the source of
// truth; this array is not kept in sync with it going forward.
const fallbackSections: Section[] = [
  {
    title: '1. Information We Collect',
    intro: 'Home Konet collects:',
    content: [
      'Personal identification',
      'Property documents',
      'Contact information',
      'Payment information',
      'Usage data and cookies',
    ],
  },
  {
    title: '4. Data Security',
    content: 'Data is stored securely using encryption and restricted access.',
  },
];

export function Privacy() {
  const [sections, setSections] = useState<Section[]>(fallbackSections);
  const [meta, setMeta] = useState<{ version: string; effective_date: string } | null>(null);

  useEffect(() => {
    legalDocumentsAPI.current()
      .then((docs) => {
        const doc = docs.find((d) => d.document_key === 'privacy_policy');
        if (doc && Array.isArray(doc.body_sections) && doc.body_sections.length > 0) {
          setSections(doc.body_sections);
          setMeta({ version: doc.version, effective_date: doc.effective_date });
        }
      })
      .catch(() => { /* keep the fallback */ });
  }, []);

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 max-w-3xl">
        <h1 className="text-4xl font-semibold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-10">
          Home Konet Privacy Policy{meta ? ` · last updated ${meta.effective_date}` : ' as of 2026'}
        </p>
        <div className="space-y-8">
          {sections.map((s) => (
            <div key={s.title}>
              <h2 className="text-lg font-semibold mb-2">{s.title}</h2>
              {s.intro && <p className="text-muted-foreground leading-relaxed mb-2">{s.intro}</p>}
              {Array.isArray(s.content) ? (
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground leading-relaxed">
                  {s.content.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                s.content && <p className="text-muted-foreground leading-relaxed">{s.content}</p>
              )}
              {s.outro && <p className="text-muted-foreground leading-relaxed mt-2">{s.outro}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
