import React from 'react';

const sections = [
  { title: '1. Information We Collect', content: 'We collect information you provide directly (name, email, phone, payment info, identity documents), information generated through your use of our platform (bookings, messages, reviews, search history), and technical data (IP address, browser type, device info, cookies).' },
  { title: '2. How We Use Your Information', content: 'We use your information to provide and improve our services, process bookings and payments, communicate with you about your account and bookings, send marketing communications (with your consent), ensure platform safety and security, and comply with legal obligations.' },
  { title: '3. Information Sharing', content: 'We share your information with hosts/guests as necessary to complete bookings, payment processors to handle transactions, identity verification services, law enforcement when required by law, and service providers who assist in our operations. We do not sell your personal data.' },
  { title: '4. Data Security', content: 'We implement industry-standard security measures including SSL encryption, secure data storage, regular security audits, and access controls. However, no method of transmission over the internet is 100% secure.' },
  { title: '5. Cookies & Tracking', content: 'We use cookies and similar technologies to maintain your session, remember your preferences, analyze platform usage, and deliver relevant content. You can control cookie settings through your browser.' },
  { title: '6. Your Rights', content: 'You have the right to access, correct, or delete your personal data, opt out of marketing communications, request data portability, and lodge a complaint with a supervisory authority. Contact us at privacy@staybnb.com to exercise these rights.' },
  { title: '7. Data Retention', content: 'We retain your data for as long as your account is active or as needed to provide services. You may request deletion of your account and associated data at any time, subject to legal retention requirements.' },
  { title: '8. Children\'s Privacy', content: 'staybnb is not intended for users under 18 years of age. We do not knowingly collect personal information from children under 18.' },
  { title: '9. International Transfers', content: 'Your data may be transferred to and processed in countries other than your own. We ensure appropriate safeguards are in place for such transfers in compliance with applicable data protection laws.' },
  { title: '10. Contact Us', content: 'For privacy-related questions or to exercise your rights, contact our Data Protection Officer at privacy@staybnb.com or write to staybnb Privacy Team, 123 Main Street, San Francisco, CA 94105.' },
];

export function Privacy() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 max-w-3xl">
        <h1 className="text-4xl font-semibold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-10">Last updated: January 1, 2026</p>
        <div className="space-y-8">
          {sections.map(s => (
            <div key={s.title}>
              <h2 className="text-lg font-semibold mb-2">{s.title}</h2>
              <p className="text-muted-foreground leading-relaxed">{s.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
