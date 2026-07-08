import React from 'react';

// Keep in sync with backend hostapplications/agreements.py
export const AGREEMENT_VERSION = '1.0';
export const AGREEMENT_EFFECTIVE_DATE = 'July 7, 2026';

type Section = { title: string; intro?: string; content: string | string[] };

const sections: Section[] = [
  {
    title: '1. Proof of Ownership',
    intro: 'Owner agrees to provide:',
    content: [
      'Probated deed and Registered Deed and Power of Attorney where applicable',
      'Relevant IDs',
      'Relevant Documents as may be required',
    ],
  },
  {
    title: '2. Accuracy of Information',
    content: 'Owner warrants that all information is true and accurate.',
  },
  {
    title: '3. Indemnification',
    intro: 'Owner or caretaker agrees to indemnify Home Konet against:',
    content: [
      'Fraud',
      'Misrepresentation',
      'Ownership disputes',
      "Any other liability growing out of owner's or caretaker's negligence or deception or other means.",
    ],
  },
  {
    title: '4. Platform Rights',
    content:
      'Home Konet may remove or suspend listings at any time with or without prior notice to the property owner or caretaker.',
  },
  {
    title: '5. No Agency Relationship',
    content:
      "Home Konet is not the Owner's or caretaker's agent or broker, and this business transaction doesn't create any agency relationship between Home Konet and Owner or Caretaker.",
  },
];

export function PropertyOwnerAgreement() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 max-w-3xl">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          Republic of Liberia
        </p>
        <h1 className="text-4xl font-semibold mb-2">Property Owner Agreement</h1>
        <p className="text-muted-foreground mb-1">Home Konet — Property Owner Listing Agreement</p>
        <p className="text-sm text-muted-foreground mb-8">
          Version {AGREEMENT_VERSION} · Effective {AGREEMENT_EFFECTIVE_DATE}
        </p>

        <p className="text-muted-foreground leading-relaxed mb-10">
          This Property Owner Listing Agreement is entered into between{' '}
          <strong className="text-foreground">Home Konet</strong> (“Platform”) and the property
          owner (“Owner”) who submits a host application. By accepting this Agreement, the Owner
          agrees to the following terms.
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
                <p className="text-muted-foreground leading-relaxed">{s.content}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
