/**
 * Premium Footer — Clean, structured, minimal.
 * 5-column grid on desktop, comprehensive internal linking for SEO.
 */
import { Link } from "wouter";
import { Star } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { GBP_REVIEW_URL } from "@shared/const";

const LINK_CLASS = "block text-[13px] text-foreground/30 hover:text-foreground/60 transition-colors duration-200";
const HEADING_CLASS = "text-[11px] font-semibold text-foreground/20 uppercase tracking-[0.1em] mb-5";

export default function SiteFooter() {
  return (
    <footer className="bg-[oklch(0.055_0.004_260)] border-t border-[oklch(0.12_0.004_260)]">
      <div className="container py-16 lg:py-20">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-10 lg:gap-8">
          {/* ─── BRAND ─── */}
          <div className="col-span-2 md:col-span-3 lg:col-span-1">
            <span className="text-primary font-bold text-[17px] tracking-[-0.02em]">
              Nick's Tire & Auto
            </span>
            <p className="mt-3 text-foreground/25 text-[13px] leading-relaxed max-w-[240px]">
              {BUSINESS.taglines.meme} Honest auto repair for Cleveland, Euclid, and Northeast Ohio since 2018.
            </p>
            <div className="mt-5 flex gap-3">
              <a
                href="https://www.instagram.com/nicks_tire_euclid/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground/15 hover:text-foreground/40 transition-colors duration-200"
                aria-label="Instagram"
              >
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
              </a>
              <a
                href="https://www.facebook.com/nickstireeuclid/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground/15 hover:text-foreground/40 transition-colors duration-200"
                aria-label="Facebook"
              >
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
              </a>
              <a
                href={GBP_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground/15 hover:text-foreground/40 transition-colors duration-200"
                aria-label="Google Reviews"
              >
                <Star className="w-[18px] h-[18px]" />
              </a>
            </div>
          </div>

          {/* ─── SERVICES ─── */}
          <div>
            <h4 className={HEADING_CLASS}>Services</h4>
            <div className="space-y-3">
              {[
                { href: "/services", label: "All Services" },
                { href: "/tires", label: "Tires (New & Used)" },
                { href: "/brakes", label: "Brakes" },
                { href: "/diagnostics", label: "Diagnostics" },
                { href: "/emissions", label: "Emissions / E-Check" },
                { href: "/oil-change", label: "Oil Change" },
                { href: "/general-repair", label: "General Repair" },
                { href: "/alignment", label: "Wheel Alignment" },
                { href: "/ac-repair", label: "AC & Heating" },
                { href: "/transmission", label: "Transmission" },
                { href: "/electrical", label: "Electrical" },
                { href: "/exhaust", label: "Exhaust & Muffler" },
                { href: "/cooling", label: "Cooling & Radiator" },
                { href: "/battery", label: "Battery Service" },
                { href: "/starter-alternator", label: "Starter & Alternator" },
                { href: "/belts-hoses", label: "Belts & Hoses" },
                { href: "/pre-purchase-inspection", label: "Pre-Purchase Inspection" },
              ].map((l) => (
                <Link key={l.href} href={l.href} className={LINK_CLASS}>{l.label}</Link>
              ))}
            </div>
          </div>

          {/* ─── TOOLS & RESOURCES ─── */}
          <div>
            <h4 className={HEADING_CLASS}>Resources</h4>
            <div className="space-y-3">
              {[
                { href: "/reviews", label: "Reviews" },
                { href: "/specials", label: "Specials & Coupons" },
                { href: "/diagnose", label: "AI Diagnostic Tool" },
                { href: "/estimate", label: "Cost Estimator" },
                { href: "/financing", label: "Financing" },
                { href: "/rewards", label: "Rewards Program" },
                { href: "/fleet", label: "Fleet Accounts" },
                { href: "/blog", label: "Blog" },
                { href: "/faq", label: "FAQ" },
                { href: "/car-care-guide", label: "Car Care Guide" },
              ].map((l) => (
                <Link key={l.href} href={l.href} className={LINK_CLASS}>{l.label}</Link>
              ))}
            </div>
          </div>

          {/* ─── AREAS SERVED ─── */}
          <div>
            <h4 className={HEADING_CLASS}>Areas Served</h4>
            <div className="space-y-3">
              {[
                { href: "/euclid-auto-repair", label: "Euclid" },
                { href: "/east-cleveland-auto-repair", label: "East Cleveland" },
                { href: "/lakewood-auto-repair", label: "Lakewood" },
                { href: "/parma-auto-repair", label: "Parma" },
                { href: "/shaker-heights-auto-repair", label: "Shaker Heights" },
                { href: "/cleveland-heights-auto-repair", label: "Cleveland Heights" },
                { href: "/south-euclid-auto-repair", label: "South Euclid" },
                { href: "/garfield-heights-auto-repair", label: "Garfield Heights" },
                { href: "/mentor-auto-repair", label: "Mentor" },
                { href: "/strongsville-auto-repair", label: "Strongsville" },
                { href: "/richmond-heights-auto-repair", label: "Richmond Heights" },
                { href: "/lyndhurst-auto-repair", label: "Lyndhurst" },
                { href: "/willoughby-auto-repair", label: "Willoughby" },
              ].map((l) => (
                <Link key={l.href} href={l.href} className={LINK_CLASS}>{l.label}</Link>
              ))}
            </div>
          </div>
        </div>

        {/* ─── BOTTOM BAR ─── */}
        <div className="mt-16 pt-8 border-t border-[oklch(0.10_0.004_260)] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-foreground/15 text-[12px]">
            &copy; {new Date().getFullYear()} Nick's Tire & Auto. All rights reserved.
          </p>
          <div className="flex items-center gap-5 flex-wrap justify-center">
            <Link href="/about" className="text-foreground/15 text-[12px] hover:text-foreground/30 transition-colors duration-200">
              About
            </Link>
            <Link href="/contact" className="text-foreground/15 text-[12px] hover:text-foreground/30 transition-colors duration-200">
              Contact
            </Link>
            <Link href="/privacy-policy" className="text-foreground/15 text-[12px] hover:text-foreground/30 transition-colors duration-200">
              Privacy
            </Link>
            <Link href="/terms" className="text-foreground/15 text-[12px] hover:text-foreground/30 transition-colors duration-200">
              Terms
            </Link>
            <a
              href={BUSINESS.phone.href}
              className="text-foreground/25 text-[13px] font-medium hover:text-foreground/40 transition-colors duration-200"
            >
              {BUSINESS.phone.display}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
