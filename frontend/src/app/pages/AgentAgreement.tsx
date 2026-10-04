import React from 'react';

// Keep in sync with backend agents/models.py
export const AGENT_AGREEMENT_VERSION = '1.0';
export const AGENT_AGREEMENT_EFFECTIVE_DATE = 'October 4, 2026';

type Section = { title: string; content: string | string[] };

const sections: Section[] = [
  {
    title: '1. Agent Participation',
    content: [
      'The Agent voluntarily chooses to register as a Home Konet Agent and agrees to comply with the rules, policies, procedures, verification requirements, and standards established by the Platform.',
      'The Agent understands that participation is voluntary and that the Agent shall operate independently in sourcing properties for submission to the Platform.',
    ],
  },
  {
    title: '2. Role of the Agent',
    content: [
      'The primary responsibility of the Agent shall be to identify and source available residential properties that may be suitable for listing on the Platform.',
      'The Agent may communicate with property owners or their authorized representatives, obtain the necessary property information and supporting documents, collect accurate owner or authorized representative contact information, obtain the correct property location, collect authentic photographs and other relevant listing information, and submit such information to the Platform for verification and approval.',
      'The Agent understands that merely submitting a property does not guarantee its approval or publication on the Platform. All properties remain subject to the Platform’s verification and approval process.',
    ],
  },
  {
    title: '3. Agent Not the Property Owner',
    content: [
      'Sourcing, submitting, or assisting with the listing of a property does not make the Agent the owner of that property.',
      'The Agent shall not represent, imply, or communicate to the Platform, a property owner, prospective tenant, customer, or any other person that the Agent owns a property merely because the Agent sourced or submitted it.',
      'The Agent shall provide accurate information identifying the actual property owner or authorized representative of every property sourced.',
    ],
  },
  {
    title: '4. Agent-Owned Property',
    content: [
      'Where the Agent personally owns a property or has legitimate legal authority to rent, lease, manage, or otherwise offer a property for occupancy, the Agent shall not submit such property as a property sourced from another owner.',
      'Any property personally owned or legitimately controlled by the Agent shall be submitted under the appropriate Host capacity on the Platform, subject to the Platform’s applicable Host registration, documentation, verification, and approval requirements.',
      'The Agent shall disclose to the Platform any personal ownership, management interest, or other financial interest in a property being submitted.',
    ],
  },
  {
    title: '5. Authenticity and Accuracy of Property Information',
    content: [
      'Every property, document, photograph, video, description, location, rental price, owner contact, and other information submitted shall be authentic, accurate, truthful, current, and representative of the actual property being submitted.',
      'The Agent shall not knowingly submit forged, altered, fraudulent, misleading, stolen, or otherwise unauthentic documents, nor present photographs/videos of one property as another, nor provide an incorrect location, false price, false description, or false owner information.',
      'Where documents are required for verification, the Agent shall make reasonable efforts to obtain legitimate and accurate documents from the property owner or authorized representative.',
    ],
  },
  {
    title: '6. Property Owner Consent',
    content: [
      'The Agent shall ensure that the property owner or an authorized representative is aware that the property is being submitted to the Platform.',
      'The Agent shall not knowingly submit another person’s property without the knowledge or authorization of the owner or an authorized representative.',
      'The Platform reserves the right to contact the property owner or authorized representative to verify the information submitted by the Agent.',
    ],
  },
  {
    title: '7. Verification and Approval',
    content:
      'All properties submitted by the Agent are subject to the Platform’s verification and approval process. The Platform may review property information, ownership documentation, photographs, location, and contact information, and may reject, suspend, remove, or request additional information for any property that does not satisfy its verification requirements. The Agent agrees to cooperate and provide truthful information whenever clarification is requested.',
  },
  {
    title: '8. False, Fraudulent, or Misleading Listings',
    content: [
      'Submitting a false, fraudulent, unauthorized, or materially misleading listing may cause financial loss, legal disputes, reputational damage, or other harm to the Platform, property owners, tenants, or other persons.',
      'Where the Agent knowingly or negligently submits an incorrect property, false documents, misleading photographs, inaccurate information, or an unauthorized listing, the Platform may remove the property, suspend or terminate the Agent’s account, withhold applicable compensation, or take other measures permitted by its policies and applicable law.',
      'Where the Agent’s actions or negligence result in damage, financial loss, fraud, legal liability, or other harm, the Agent may be held responsible in accordance with the applicable laws of the Republic of Liberia.',
    ],
  },
  {
    title: '9. Agent Compensation',
    content: [
      'For every successful booking completed on a property sourced and successfully listed by the Agent, the Agent shall receive twenty-five percent (25%) of the commission earned by the Platform from that booking.',
      'The Platform’s current commission on a successful booking is two percent (2%) of the applicable booking value. For example, where the Platform earns US $20.00 from a successful booking, the Agent receives 25% of that commission, equal to US $5.00.',
      'The compensation structure may be reviewed and changed at the sole discretion of the Platform, and any change will be communicated to the Agent before it takes effect. No compensation is payable for cancelled, fraudulent, invalid, unauthorized, or otherwise non-qualifying bookings, or where the property was submitted using false or materially inaccurate information.',
    ],
  },
  {
    title: '10. Professional Conduct',
    content:
      'The Agent agrees to conduct themselves honestly, professionally, and respectfully with property owners, tenants, prospective customers, Platform representatives, and the public, and shall not engage in fraudulent, deceptive, abusive, threatening, or unlawful conduct in connection with their activities on or through the Platform.',
  },
  {
    title: '11. Confidentiality and Protection of Information',
    content:
      'The Agent agrees to protect confidential information obtained through their activities with the Platform — including owner contact information, identification documents, property documents, customer information, and internal Platform information — and shall not sell, distribute, disclose, misuse, or otherwise share it with unauthorized persons or use it for unrelated purposes.',
  },
  {
    title: '12. Independent Participation',
    content:
      'Registration as a Home Konet Agent does not make the Agent an employee, partner, director, owner, or legal representative of the Platform. The Agent participates independently and is not authorized to make commitments, agreements, representations, or decisions on behalf of the Platform unless expressly authorized in writing.',
  },
  {
    title: '13. Suspension or Termination',
    content:
      'The Platform may suspend or terminate the Agent’s participation where the Agent violates this Agreement, repeatedly submits properties that fail verification, provides false or fraudulent information, misrepresents property ownership, submits unauthorized properties, engages in misconduct, or otherwise exposes the Platform or its users to unnecessary risk or liability. Suspension or termination does not prevent the Platform or any affected party from pursuing any lawful rights or remedies arising from the Agent’s conduct.',
  },
  {
    title: '14. Governing Law',
    content:
      'This Agreement is governed by and interpreted in accordance with the applicable laws of the Republic of Liberia. Any dispute arising from or relating to this Agreement shall be addressed in accordance with the applicable laws and legal procedures of the Republic of Liberia.',
  },
  {
    title: '15. Acknowledgement',
    content:
      'By accepting this Agreement and/or completing the Home Konet Agent registration process, the Agent confirms that they have read, understood, and agreed to its terms — including that their primary responsibility is to source legitimate properties belonging to other owners, that sourcing a property does not make them its owner, and that any property they personally own or manage must be submitted under the Host capacity instead.',
  },
];

export function AgentAgreement() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 max-w-3xl">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          Republic of Liberia · Montserrado County
        </p>
        <h1 className="text-4xl font-semibold mb-2">Home Konet Agent Agreement</h1>
        <p className="text-muted-foreground mb-1">For sourcing agents listing properties on behalf of owners</p>
        <p className="text-sm text-muted-foreground mb-8">
          Version {AGENT_AGREEMENT_VERSION} · Effective {AGENT_AGREEMENT_EFFECTIVE_DATE}
        </p>

        <p className="text-muted-foreground leading-relaxed mb-4">
          This Home Konet Agent Agreement is entered into between{' '}
          <strong className="text-foreground">Home Konet</strong> (“Platform”), of the City of
          Monrovia, County of Montserrado, Republic of Liberia, and the person (“Agent”) who
          registers as a Home Konet Agent to source available residential properties for listing on
          the Platform. The Agent’s role is limited to sourcing and submitting legitimate properties,
          and registration does not make the Agent an employee, partner, owner, or legal
          representative of the Platform.
        </p>
        <p className="text-muted-foreground leading-relaxed mb-10">
          NOW, THEREFORE, in consideration of the Agent’s voluntary registration and the mutual
          understanding of the parties, the Agent agrees to the following terms and conditions:
        </p>

        <div className="space-y-8">
          {sections.map((s) => (
            <div key={s.title}>
              <h2 className="text-lg font-semibold mb-2">{s.title}</h2>
              {Array.isArray(s.content) ? (
                <div className="space-y-2">
                  {s.content.map((p) => (
                    <p key={p} className="text-muted-foreground leading-relaxed">{p}</p>
                  ))}
                </div>
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
