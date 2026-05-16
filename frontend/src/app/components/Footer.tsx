import React from 'react';
import { Globe } from 'lucide-react';
import { Link } from 'react-router';
import { Separator } from './ui/separator';
import { NewsletterSignup } from './NewsletterSignup';
import logo from '../../assets/logo2.jpg';

export function Footer() {
  return (
    <footer className="border-t border-border bg-muted/30 mt-20">
      {/* Newsletter strip */}
      <div className="border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-8 flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="shrink-0">
            <p className="font-semibold text-sm mb-0.5">Stay in the loop</p>
            <p className="text-xs text-muted-foreground">New listings, hotel deals & exclusive discounts — in your inbox.</p>
          </div>
          <div className="flex-1 max-w-sm">
            <NewsletterSignup />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div>
            <h3 className="font-semibold mb-4">Support</h3>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><Link to="/help" className="hover:text-foreground">Help Center</Link></li>
              <li><Link to="/help#safety" className="hover:text-foreground">Safety information</Link></li>
              <li><Link to="/help#cancellation" className="hover:text-foreground">Cancellation options</Link></li>
              <li><Link to="/faq" className="hover:text-foreground">FAQ</Link></li>
              <li><Link to="/contact" className="hover:text-foreground">Contact us</Link></li>
              <li><Link to="/support" className="hover:text-foreground">Support tickets</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-4">Community</h3>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><Link to="/search" className="hover:text-foreground">Browse listings</Link></li>
              <li><Link to="/reviews" className="hover:text-foreground">Guest reviews</Link></li>
              <li><Link to="/privacy#anti-discrimination" className="hover:text-foreground">Anti-discrimination policy</Link></li>
              <li><Link to="/terms" className="hover:text-foreground">Terms of service</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-4">Hosting</h3>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><Link to="/host/new" className="hover:text-foreground">List your property</Link></li>
              <li><Link to="/host" className="hover:text-foreground">Host dashboard</Link></li>
              <li><Link to="/help#hosting" className="hover:text-foreground">Hosting resources</Link></li>
              <li><Link to="/help#responsible" className="hover:text-foreground">Host responsibly</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-4">
              <img src={logo} alt="HomeKonet" className="h-8 w-auto" />
            </h3>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><Link to="/help#about" className="hover:text-foreground">About us</Link></li>
              <li><Link to="/notifications" className="hover:text-foreground">Notifications</Link></li>
              <li><Link to="/account" className="hover:text-foreground">My account</Link></li>
              <li><Link to="/trips" className="hover:text-foreground">My trips</Link></li>
            </ul>
          </div>
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            <p>© 2026 HomeKonet, Inc.</p>
            <span>·</span>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <span>·</span>
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <span>·</span>
            <Link to="/search" className="hover:text-foreground">Sitemap</Link>
          </div>
          <div className="flex items-center gap-4">
            <button className="flex items-center gap-2 hover:text-foreground">
              <Globe className="w-4 h-4" />
              <span>English (US)</span>
            </button>
            <button className="hover:text-foreground">USD</button>
          </div>
        </div>
      </div>
    </footer>
  );
}
