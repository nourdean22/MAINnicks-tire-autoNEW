/**
 * Site Footer — 4-column grid with top CTA stripe, comprehensive linking for SEO.
 */
import { Link } from "wouter";
import { Star } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { GBP_REVIEW_URL } from "@shared/const";

const LINK_CLASS = "block text-[13px] text-foreground/30 hover:text-foreground/60 transition-colors duration-200";
const HEADING_CLASS = "text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/50 mb-5";

export default function SiteFooter() {
  return (
    <footer>
      {/* ─── TOP CTA STRIPE ─── */}
      <div className="bg-[#FDB913] py-3.5">
        <div className="container text-center">
          <p className="text-black text-sm sm:text-base font-semibold">
            Ready to get your car fixed?{" "}
            <a href={BUSINESS.phone.href} className="underline hover:no-underline">
              Call {BUSINESS.phone.display}
            </a>{" "}
            or{" "}
            <Link href="/booking" className="underline hover:no-underline">
              Book Online
            </Link>
          </p>
        </div>
      </div>

      {/* ─── MAIN FOOTER ─── */}
      <div className="bg-[#080808] border-t border-[#2A2A2A]">
        <div className="container py-16 lg:py-20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 lg:gap-8">
            {/* ─── COL 1: BRAND ─── */}
            <div className="col-span-2 md:col-span-1">
              <span className="text-[#FDB913] font-bold text-[17px] tracking-[-0.02em]">
                Nick's Tire & Auto
              </span>
              <p className="mt-3 text-foreground/25 text-[13px] leading-relaxed max-w-[240px]">
                {BUSINESS.taglines.meme} Honest auto repair for Cleveland since 2018.
              </p>
              <p className="mt-3 text-foreground/30 text-[13px] leading-relaxed">
                {BUSINESS.address.full}
              </p>
              <a href={BUSINESS.phone.href} className="block mt-1 text-foreground/30 hover:text-foreground/60 text-[13px] transition-colors duration-200">
                {BUSINESS.phone.display}
              </a>
              {/* Social links */}
              <div className="mt-5 flex gap-3">
                <a
                  href="https://www.instagram.com/nicks_tire_euclid/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/30 hover:text-foreground/60 transition-colors duration-200"
                  aria-label="Instagram"
                >
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                </a>
                <a
                  href="https://www.facebook.com/nickstireeuclid/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/30 hover:text-foreground/60 transition-colors duration-200"
                  aria-label="Facebook"
                >
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                </a>
                <a
                  href={GBP_REVIEW_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/30 hover:text-foreground/60 transition-colors duration-200"
                  aria-label="Google Reviews"
                >
                  <Star className="w-[18px] h-[18px]" />
                </a>
              </div>
            </div>

            {/* ─── COL 2: SERVICES ─── */}
            <div>
              <h4 className={HEADING_CLASS}>Services</h4>
              <div className="space-y-3">
                {[
                  { href: "/tires", label: "Tires" },
                  { href: "/brakes", label: "Brakes" },
                  { href: "/diagnostics", label: "Diagnostics" },
                  { href: "/emissions", label: "Emissions / E-Check" },
                  { href: "/oil-change", label: "Oil Change" },
                  { href: "/general-repair", label: "General Repair" },
                  { href: "/ac-repair", label: "AC & Heating" },
                  { href: "/transmission", label: "Transmission" },
                  { href: "/electrical", label: "Electrical" },
                  { href: "/exhaust", label: "Exhaust & Muffler" },
                  { href: "/alignment", label: "Wheel Alignment" },
                  { href: "/battery", label: "Battery Service" },
                ].map((l) => (
                  <Link key={l.href} href={l.href} className={LINK_CLASS}>{l.label}</Link>
                ))}
              </div>
            </div>

            {/* ─── COL 3: RESOURCES ─── */}
            <div>
              <h4 className={HEADING_CLASS}>Resources</h4>
              <div className="space-y-3">
                {[
                  { href: "/reviews", label: "Reviews" },
                  { href: "/blog", label: "Blog" },
                  { href: "/faq", label: "FAQ" },
                  { href: "/car-care-guide", label: "Car Care Guide" },
                  { href: "/diagnose", label: "Diagnose My Car" },
                  { href: "/financing", label: "Financing" },
                  { href: "/specials", label: "Specials" },
                  { href: "/careers", label: "Careers" },
                  { href: "/estimate", label: "Cost Estimator" },
                  { href: "/fleet", label: "Fleet" },
                  { href: "/appointment", label: "Book Online" },
                ].map((l) => (
                  <Link key={l.href} href={l.href} className={LINK_CLASS}>{l.label}</Link>
                ))}
              </div>
            </div>

            {/* ─── COL 4: AREAS SERVED ─── */}
            <div>
              <h4 className={HEADING_CLASS}>Areas Served</h4>
              <div className="space-y-3">
                {[
                  { href: "/cleveland-auto-repair", label: "Cleveland" },
                  { href: "/euclid-auto-repair", label: "Euclid" },
                  { href: "/east-cleveland-auto-repair", label: "East Cleveland" },
                  { href: "/lakewood-auto-repair", label: "Lakewood" },
                  { href: "/parma-auto-repair", label: "Parma" },
                  { href: "/south-euclid-auto-repair", label: "South Euclid" },
                  { href: "/garfield-heights-auto-repair", label: "Garfield Heights" },
                  { href: "/cleveland-heights-auto-repair", label: "Cleveland Heights" },
                  { href: "/shaker-heights-auto-repair", label: "Shaker Heights" },
                  { href: "/richmond-heights-auto-repair", label: "Richmond Heights" },
                  { href: "/lyndhurst-auto-repair", label: "Lyndhurst" },
                  { href: "/mentor-auto-repair", label: "Mentor" },
                  { href: "/strongsville-auto-repair", label: "Strongsville" },
                  { href: "/willoughby-auto-repair", label: "Willoughby" },
                  { href: "/maple-heights-auto-repair", label: "Maple Heights" },
                  { href: "/bedford-auto-repair", label: "Bedford" },
                  { href: "/warrensville-heights-auto-repair", label: "Warrensville Heights" },
                ].map((l) => (
                  <Link key={l.href} href={l.href} className={LINK_CLASS}>{l.label}</Link>
                ))}
              </div>
            </div>
          </div>

          {/* ─── BOTTOM BAR ─── */}
          <div className="mt-16 pt-8 border-t border-[#2A2A2A] flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-foreground/20 text-[12px]">
              &copy; {new Date().getFullYear()} Nick's Tire & Auto. All rights reserved.
            </p>
            <p className="text-foreground/20 text-[12px]">
              Honest auto repair for Cleveland since 2018
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
