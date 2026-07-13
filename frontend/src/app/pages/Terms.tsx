import React, { useEffect, useState } from 'react';
import { legalDocumentsAPI } from '../../services/api/legalDocuments';
import type { LegalDocumentSection as Section } from '../../services/api/legalDocuments';

// Fallback only — shown if the legal-documents API is unreachable so the
// page never renders blank. The DB-backed version (editable via
// Management > Roles & Permissions... > Legal Documents) is the source of
// truth; this array is not kept in sync with it going forward.
const fallbackSections: Section[] = [
  {
    title: '1. Introduction',
    content:
      'This Terms of Service Agreement ("Agreement") governs the use of Home Konet, an online real-estate marketplace platform ("the Platform") operating under the Laws of the Republic of Liberia and in the Republic of Liberia. By accessing or using the Platform, all users ("Users") agree to be bound by this Agreement.',
  },
  {
    title: '2. Nature of the Platform',
    content: [
      'Home Konet is a platform that provides ease of access via an online marketplace for listing, renting, leasing, and purchasing of real property in Liberia.',
      'Home Konet is not a real-estate broker, agent, or legal representative of any User.',
      'All transactions occur directly between Users. We just provide the platform.',
    ],
  },
];

export function Terms() {
  const [sections, setSections] = useState<Section[]>(fallbackSections);
  const [meta, setMeta] = useState<{ version: string; effective_date: string } | null>(null);

  useEffect(() => {
    legalDocumentsAPI.current()
      .then((docs) => {
        const doc = docs.find((d) => d.document_key === 'terms_of_service');
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
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          Republic of Liberia, Montserrado County
        </p>
        <h1 className="text-4xl font-semibold mb-2">Terms and Agreement</h1>
        <p className="text-muted-foreground mb-10">
          Home Konet — Terms of Service{meta && ` · last updated ${meta.effective_date}`}
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
