import React from 'react';

const sections = [
  { title: '1. Acceptance of Terms', content: 'By accessing or using staybnb, you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using or accessing this site.' },
  { title: '2. Use License', content: 'Permission is granted to temporarily use staybnb for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not modify or copy the materials, use the materials for any commercial purpose, or attempt to decompile or reverse engineer any software contained on staybnb.' },
  { title: '3. Booking & Payments', content: 'All bookings made through staybnb are subject to availability and host approval (unless instant booking is enabled). Payment is processed securely at the time of booking. Prices displayed include all applicable fees and taxes as shown at checkout.' },
  { title: '4. Cancellation Policy', content: 'Cancellation policies vary by listing and are clearly displayed before booking. Refunds are processed according to the applicable cancellation policy. staybnb\'s service fee is non-refundable in cases of cancellation.' },
  { title: '5. Host Responsibilities', content: 'Hosts are responsible for ensuring their listings are accurate, safe, and comply with all local laws and regulations. Hosts must maintain the property as described and honor confirmed bookings.' },
  { title: '6. Guest Responsibilities', content: 'Guests must treat host properties with respect, follow house rules, and not exceed the maximum occupancy. Guests are liable for any damages caused during their stay.' },
  { title: '7. Prohibited Activities', content: 'Users may not use staybnb for any unlawful purpose, to solicit others to perform unlawful acts, to violate any regulations, to infringe upon intellectual property rights, to harass or discriminate against others, or to submit false or misleading information.' },
  { title: '8. Limitation of Liability', content: 'staybnb shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of or inability to use the service, even if staybnb has been advised of the possibility of such damages.' },
  { title: '9. Privacy Policy', content: 'Your use of staybnb is also governed by our Privacy Policy, which is incorporated into these Terms by reference. Please review our Privacy Policy to understand our practices.' },
  { title: '10. Changes to Terms', content: 'staybnb reserves the right to modify these terms at any time. We will notify users of significant changes via email or prominent notice on the platform. Continued use after changes constitutes acceptance of the new terms.' },
];

export function Terms() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 max-w-3xl">
        <h1 className="text-4xl font-semibold mb-2">Terms of Service</h1>
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
