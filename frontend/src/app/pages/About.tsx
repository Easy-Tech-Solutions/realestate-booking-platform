import React from 'react';
import { Shield, Users, MapPin, Star } from 'lucide-react';

const VALUES = [
  {
    icon: Shield,
    title: 'Trust & Safety',
    description: 'Every listing is reviewed before going live. Payments are encrypted and processed through PCI-compliant gateways.',
  },
  {
    icon: Users,
    title: 'Community First',
    description: 'We connect guests and hosts in a transparent, respectful marketplace built on genuine reviews and honest listings.',
  },
  {
    icon: MapPin,
    title: 'Local Expertise',
    description: 'From city apartments to beachside lodges, we spotlight the best stays across Ghana and beyond.',
  },
  {
    icon: Star,
    title: 'Quality Experience',
    description: 'Our Superhost program and review system ensure guests always know what to expect before they book.',
  },
];

export function About() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="bg-gradient-to-br from-primary/10 via-background to-background border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-16 text-center">
          <h1 className="text-4xl sm:text-5xl font-semibold mb-4">About HomeKonet</h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            HomeKonet is a property booking platform that makes it easy to find, book, and host unique accommodations — from cosy apartments to luxury hotels.
          </p>
        </div>
      </div>

      {/* Story */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-16 max-w-3xl">
        <h2 className="text-2xl font-semibold mb-4">Our Story</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          HomeKonet was founded with a simple mission: make finding a great place to stay as easy as possible. We saw that travellers were spending hours comparing options across platforms while hosts struggled to reach the right guests. We built a single, seamless marketplace to solve both problems.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          Today, HomeKonet hosts thousands of listings across multiple property types — apartments, hotels, lodges, beachside retreats, and more — all bookable in minutes with support for mobile money and card payments.
        </p>
      </div>

      {/* Values */}
      <div className="bg-muted/30 border-y border-border py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20">
          <h2 className="text-2xl font-semibold text-center mb-10">What We Stand For</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {VALUES.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex flex-col items-center text-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-16 text-center">
        <h2 className="text-2xl font-semibold mb-3">Ready to find your next stay?</h2>
        <p className="text-muted-foreground mb-6">Browse thousands of properties and book with confidence.</p>
        <a
          href="/"
          className="inline-flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors"
        >
          Browse listings
        </a>
      </div>
    </div>
  );
}
