import React from 'react';
import { Globe } from 'lucide-react';
import { Link } from 'react-router';
import { Separator } from './ui/separator';

export function Footer() {
  return (
    <footer className="border-t border-border bg-muted/30 mt-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div>
            <h3 className="font-semibold mb-4">Support</h3>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><Link to="/help" className="hover:text-foreground">Help Center</Link></li>
              <li><Link to="/help" className="hover:text-foreground">Safety information</Link></li>
              <li><Link to="/help" className="hover:text-foreground">Cancellation options</Link></li>
              <li><Link to="/help" className="hover:text-foreground">Our COVID-19 Response</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-4">Community</h3>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><a href="#" className="hover:text-foreground">Disaster relief housing</a></li>
              <li><a href="#" className="hover:text-foreground">Support Afghan refugees</a></li>
              <li><a href="#" className="hover:text-foreground">Combating discrimination</a></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-4">Hosting</h3>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><Link to="/host/new" className="hover:text-foreground">Try hosting</Link></li>
              <li><Link to="/help" className="hover:text-foreground">Explore hosting resources</Link></li>
              <li><a href="#" className="hover:text-foreground">Visit our community forum</a></li>
              <li><Link to="/help" className="hover:text-foreground">How to host responsibly</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-4">staybnb</h3>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><a href="#" className="hover:text-foreground">Newsroom</a></li>
              <li><a href="#" className="hover:text-foreground">Learn about new features</a></li>
              <li><a href="#" className="hover:text-foreground">Careers</a></li>
              <li><a href="#" className="hover:text-foreground">Investors</a></li>
            </ul>
          </div>
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            <p>© 2026 staybnb, Inc.</p>
            <span>·</span>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <span>·</span>
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <span>·</span>
            <a href="#" className="hover:text-foreground">Sitemap</a>
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
