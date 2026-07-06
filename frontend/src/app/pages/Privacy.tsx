import React from 'react';

type Section = { title: string; intro?: string; content: string | string[]; outro?: string };

const sections: Section[] = [
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
    title: '2. How We Use Information',
    intro: 'Home Konet uses data to:',
    content: [
      'Verify ownership or relationship to the property',
      'Facilitate communication',
      'Improve platform services',
      'Prevent fraud',
      'Comply with legal obligations',
    ],
  },
  {
    title: '3. Data Sharing',
    intro: 'We may share data with:',
    content: [
      'Verification partners',
      'Law enforcement',
      'Payment processors',
      'Regulatory authorities',
    ],
    outro: 'We do not sell personal data.',
  },
  {
    title: '4. Data Security',
    content: 'Data is stored securely using encryption and restricted access.',
  },
  {
    title: '5. User Rights',
    intro: 'Users may request:',
    content: ['Data deletion', 'Data correction', 'Data access'],
  },
  {
    title: '6. Cookies',
    content: 'Cookies are used for analytics and user experience.',
  },
  {
    title: '7. Policy Updates',
    content: 'Home Konet may update this policy and notify Users accordingly.',
  },
];

export function Privacy() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 max-w-3xl">
        <h1 className="text-4xl font-semibold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-10">Home Konet Privacy Policy as of 2026</p>
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
