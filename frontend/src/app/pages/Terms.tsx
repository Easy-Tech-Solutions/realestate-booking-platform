import React from 'react';

type Section = { title: string; intro?: string; content: string | string[] };

const sections: Section[] = [
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
  {
    title: '3. User Eligibility',
    content: [
      'Users must be at least 18 years old.',
      'Users must provide accurate and truthful information. By using our platform, the user confirms that he/she is 18 years or older.',
    ],
  },
  {
    title: '4. Property Owner Obligations',
    content: [
      'Owners must provide valid proof of ownership.',
      'Owners warrant that all information provided is accurate.',
      'Owners indemnify Home Konet against losses arising from misrepresentation.',
    ],
  },
  {
    title: '5. Platform Rights',
    content: [
      'Home Konet may approve, reject, or remove listings.',
      'Home Konet may suspend or terminate accounts for violations.',
    ],
  },
  {
    title: '6. Fees and Payments',
    content: [
      'Users agree to pay all applicable fees as required by Home Konet.',
      'Fees are non-refundable unless expressly stated.',
    ],
  },
  {
    title: '7. Limitation of Liability',
    intro: 'Home Konet is not liable for:',
    content: [
      'Fraud by Users',
      'Failed transactions',
      'Ownership disputes',
      'Loss of funds',
      'Misrepresentation',
    ],
  },
  {
    title: '7.2 Maximum Liability',
    content:
      'By using our platform, users and heirs, executors, assigns, etc. agree that liability against Home Konet is limited to the amount paid to Home Konet in the preceding 12 months.',
  },
  {
    title: '8. Dispute Resolution',
    content: [
      'User-to-User disputes must be resolved between the parties.',
      'Disputes involving Home Konet shall be resolved through arbitration based upon the arbitration laws as provided for in Chapter 64 of the Civil Procedure Law of Liberia.',
    ],
  },
  {
    title: '9. Governing Law',
    content: 'This Agreement is governed by the laws of the Republic of Liberia.',
  },
  {
    title: '10. Acceptance',
    content: 'By using the Platform, Users acknowledge acceptance of these Terms.',
  },
];

export function Terms() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 max-w-3xl">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          Republic of Liberia, Montserrado County
        </p>
        <h1 className="text-4xl font-semibold mb-2">Terms and Agreement</h1>
        <p className="text-muted-foreground mb-10">Home Konet — Terms of Service</p>
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
