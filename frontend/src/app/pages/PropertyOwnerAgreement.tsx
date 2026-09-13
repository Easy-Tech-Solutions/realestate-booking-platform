import React from 'react';

// Keep in sync with backend hostapplications/agreements.py
export const AGREEMENT_VERSION = '2.0';
export const AGREEMENT_EFFECTIVE_DATE = 'September 12, 2026';

type Section = { title: string; intro?: string; content: string | string[] };

const sections: Section[] = [
  {
    title: '1. Proof of Ownership',
    content:
      'Owner agrees to provide Home Konet with valid documents and information necessary to verify the Owner’s ownership or authority to list the property. Such documentation shall include the probated deed and registered deed, and Power of Attorney where applicable, relevant identification documents, and any other relevant documents that may reasonably be required by Home Konet for verification purposes.',
  },
  {
    title: '2. Accuracy of Information',
    content:
      'Owner warrants that all information provided to Home Konet concerning the property, including ownership, location, availability, rental price, property condition, and other material information, is true, complete, and accurate. The Owner agrees to promptly notify Home Konet of any material change affecting the property or its listing.',
  },
  {
    title: '3. Indemnification',
    content:
      'Owner or caretaker agrees to indemnify and hold Home Konet harmless against any claims, losses, liabilities, damages, costs, or expenses arising from fraud, misrepresentation, ownership disputes, or any other liability growing out of the Owner’s or caretaker’s negligence, deception, unauthorized conduct, or other wrongful act relating to the property.',
  },
  {
    title: '4. Home Konet Business Model and Fees',
    content:
      'Owner acknowledges and agrees that Home Konet operates as a property marketplace and platform through which prospective tenants may discover properties, express interest, arrange property viewings, make bookings, and proceed with rental transactions. As part of its business model, Home Konet may generate revenue through applicable transaction and service fees, including a $3 property viewing fee payable by the prospective tenant where applicable, a 2% tenant booking commission payable by the tenant where applicable, and a 2% landlord commission payable by the Owner on the applicable rental or booking transaction processed through, or originating from, Home Konet. The Owner authorizes Home Konet to collect the applicable landlord commission and any other platform charges due from the Owner through the payment process established by Home Konet.',
  },
  {
    title: '5. Platform-Only Payments and No Off-Platform Transactions',
    content:
      'Where a prospective tenant discovers, views, contacts, books, or otherwise shows interest in the Owner’s property through Home Konet, the Owner agrees that any payment that Home Konet requires the tenant to make in connection with the listing, viewing, booking, or rental transaction shall be made through the Home Konet platform or through a payment method officially designated by Home Konet. The Owner shall not instruct, encourage, pressure, or permit a prospective tenant or tenant introduced through Home Konet to make such payment directly to the Owner, caretaker, or any third party for the purpose of avoiding Home Konet’s platform process or applicable fees.',
  },
  {
    title: '6. No Circumvention',
    content:
      'The Owner agrees not to use contact information, introductions, leads, property viewings, or other information obtained through Home Konet to bypass the Platform and complete a rental transaction privately for the purpose of avoiding any commission, fee, or other amount due to Home Konet. Where a tenant or prospective tenant first discovers or is introduced to the property through Home Konet and subsequently completes a rental transaction with the Owner or caretaker, the Owner remains responsible for the applicable Home Konet commission in accordance with this Agreement, even if the final transaction is completed outside the platform.',
  },
  {
    title: '7. Owner’s Cooperation with the Platform',
    content:
      'Owner agrees to cooperate with Home Konet in confirming property availability, pricing, ownership, tenant interest, booking information, and transaction information reasonably required to administer the listing, facilitate transactions, and collect applicable fees.',
  },
  {
    title: '8. Platform Rights',
    content:
      'Home Konet may remove, suspend, reject, or restrict a property listing at any time, with or without prior notice to the Owner or caretaker, including where Home Konet has concerns regarding verification, accuracy, compliance, payment, safety, fraud, misrepresentation, or misuse of the Platform.',
  },
  {
    title: '9. No Agency Relationship',
    content:
      'Home Konet is not the Owner’s or caretaker’s agent or broker, and this business transaction does not create any agency, employment, partnership, or joint venture relationship between Home Konet and the Owner or caretaker.',
  },
  {
    title: '10. Compliance and Enforcement',
    content:
      'A violation of the payment, commission, or no-circumvention provisions of this Agreement may result in removal of the property listing, suspension or termination of the Owner’s access to Home Konet, and recovery of any fees or commissions properly due to Home Konet. Home Konet may take such action without prejudice to any other rights or remedies available under applicable law.',
  },
  {
    title: '11. Acknowledgment',
    content:
      'By accepting this Agreement, the Owner confirms that they have read, understood, and agreed to the terms of this Property Owner Agreement, including Home Konet’s commission structure, platform-only payment requirements, and no-circumvention obligations.',
  },
];

export function PropertyOwnerAgreement() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 max-w-3xl">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          Republic of Liberia · Montserrado County
        </p>
        <h1 className="text-4xl font-semibold mb-2">Property Owner Agreement</h1>
        <p className="text-muted-foreground mb-1">Home Konet — Property Owner Listing Agreement</p>
        <p className="text-sm text-muted-foreground mb-8">
          Version {AGREEMENT_VERSION} · Effective {AGREEMENT_EFFECTIVE_DATE}
        </p>

        <p className="text-muted-foreground leading-relaxed mb-4">
          This Property Owner Listing Agreement is entered into between{' '}
          <strong className="text-foreground">Home Konet</strong> (“Platform”), of the City of
          Monrovia, County of Montserrado, Republic of Liberia, and the property owner (“Owner”)
          who submits a host application. The Owner represents that they are the lawful owner of,
          or are duly authorized to list and transact in respect of, the property described in
          this Agreement.
        </p>
        <p className="text-muted-foreground leading-relaxed mb-10">
          NOW, THEREFORE, in consideration of the mutual understanding and agreements contained
          herein, the Parties agree as follows:
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
