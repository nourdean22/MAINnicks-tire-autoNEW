/**
 * Shared Tesla-style Footer — used across all pages.
 * Minimal, 4-column, dark, no gradients.
 */
import { Link } from "wouter";
import { Star } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { GBP_REVIEW_URL } from "@shared/const";

export default function SiteFooter() {
  return (
    <footer className="section-darker border-t border-border">
      <div className="container py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          <div>
            <span className="text-nick-yellow font-semibold text-lg tracking-tight">Nick's Tire & Auto</span>
            <p className="mt-3 text-foreground/30 text-sm leading-relaxed">
              Honest auto repair for Cleveland, Euclid, and Northeast Ohio.
            </p>
            <div className="mt-4 flex gap-3">
              <a href="https://www.instagram.com/nicks_tire_euclid/" target="_blank" rel="noopener noreferrer" className="text-foreground/20 hover:text-foreground/50 transition-colors" aria-label="Instagram">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
              </a>
              <a href="https://www.facebook.com/nickstireeuclid/" target="_blank" rel="noopener noreferrer" className="text-foreground/20 hover:text-foreground/50 transition-colors" aria-label="Facebook">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
              </a>
              <a href={GBP_REVIEW_URL} target="_blank" rel="noopener noreferrer" className="text-foreground/20 hover:text-foreground/50 transition-colors" aria-label="Google Reviews">
                <Star className="w-5 h-5" />
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-4">Services</h4>
            <div className="space-y-2.5 text-sm text-foreground/40">
              <Link href="/tires" className="block hover:text-foreground transition-colors">Tires</Link>
              <Link href="/brakes" className="block hover:text-foreground transition-colors">Brakes</Link>
              <Link href="/diagnostics" className="block hover:text-foreground transition-colors">Diagnostics</Link>
              <Link href="/emissions" className="block hover:text-foreground transition-colors">Emissions</Link>
              <Link href="/oil-change" className="block hover:text-foreground transition-colors">Oil Change</Link>
              <Link href="/general-repair" className="block hover:text-foreground transition-colors">General Repair</Link>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-4">Resources</h4>
            <div className="space-y-2.5 text-sm text-foreground/40">
              <Link href="/reviews" className="block hover:text-foreground transition-colors">Reviews</Link>
              <Link href="/specials" className="block hover:text-foreground transition-colors">Specials</Link>
              <Link href="/diagnose" className="block hover:text-foreground transition-colors">Diagnose My Car</Link>
              <Link href="/blog" className="block hover:text-foreground transition-colors">Blog</Link>
              <Link href="/faq" className="block hover:text-foreground transition-colors">FAQ</Link>
              <Link href="/car-care-guide" className="block hover:text-foreground transition-colors">Car Care Guide</Link>
              <Link href="/pricing" className="block hover:text-foreground transition-colors">Price Estimator</Link>
              <Link href="/status" className="block hover:text-foreground transition-colors">Check Repair Status</Link>
              <Link href="/rewards" className="block hover:text-foreground transition-colors">Rewards Program</Link>
              <Link href="/fleet" className="block hover:text-foreground transition-colors">Fleet Accounts</Link>
              <Link href="/financing" className="block hover:text-foreground transition-colors">Financing</Link>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-4">Areas Served</h4>
            <div className="space-y-2.5 text-sm text-foreground/40">
              <span className="block">Cleveland, OH</span>
              <Link href="/euclid-auto-repair" className="block hover:text-foreground transition-colors">Euclid, OH</Link>
              <Link href="/east-cleveland-auto-repair" className="block hover:text-foreground transition-colors">East Cleveland, OH</Link>
              <Link href="/lakewood-auto-repair" className="block hover:text-foreground transition-colors">Lakewood, OH</Link>
              <Link href="/parma-auto-repair" className="block hover:text-foreground transition-colors">Parma, OH</Link>
            </div>
          </div>
        </div>

        <div className="mt-14 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-foreground/20 text-xs">
            &copy; {new Date().getFullYear()} Nick's Tire & Auto. All rights reserved.
          </p>
          <a href={BUSINESS.phone.href} className="text-foreground/30 text-sm hover:text-foreground/50 transition-colors">
            {BUSINESS.phone.display}
          </a>
        </div>
      </div>
    </footer>
  );
}
