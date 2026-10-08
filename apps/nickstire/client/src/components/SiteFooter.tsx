/**
 * Site Footer — 4-column grid with top CTA stripe, comprehensive linking for SEO.
 */
import { Link } from "wouter";
import { Star } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { GBP_REVIEW_URL } from "@shared/const";
import BrandMark from "@/components/BrandMark";
import { trpc } from "@/lib/trpc";
// attribution-wave 2026-06: footer call/text links appear on EVERY page —
// they were untracked plain anchors, dropping site-wide conversion signal.
import { trackPhoneClick, trackEvent } from "@/components/SEO";
// 2026-05-19 · EmailNewsletterCapture import removed · band killed (see render).

const LINK_CLASS = "block text-[13px] text-foreground/60 hover:text-foreground/90 transition-colors duration-200";
const HEADING_CLASS = "text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/70 mb-5";

export default function SiteFooter() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, { staleTime: 60 * 60 * 1000, retry: 1 });
  const reviewRating = googleData?.rating ?? BUSINESS.reviews.rating;
  const reviewCount = googleData?.totalReviews ?? BUSINESS.reviews.count;
  const reviewCountDisplay = `${reviewCount.toLocaleString("en-US")}+`;

  return (
    <footer>
      {/* ─── BRAND SIGN BANNER — actual photo of the actual sign ─── */}
      {/* Voice-led "pull up" overlay turns a global trust strip into a final-impression
          memory anchor before the user leaves the page. The photo does the heavy lifting:
          real building, real Euclid Ave block, real phone number visible in the sign. */}
      {/* 2026-05-06 wave-30 · mobile h-[220px] left visible letterbox above
          and below the contain'd 6.69:1 panorama. Tightened mobile to
          h-[160px] so the sign fills more of the visible area; sm+ keeps
          taller bands where the wider viewport absorbs the letterbox. */}
      <div className="relative h-[160px] sm:h-[240px] lg:h-[320px] overflow-hidden bg-[#0B0B0B]">
        {/* 2026-05-06 wave-27 · /brand-sign.webp is 1600×239 (panorama,
            aspect 6.69:1). Inside the footer banner (1090×220–360,
            aspect ~3–5:1) object-fit:cover would zoom 1.5–4× and clip
            the sides of the sign, defeating the "real sign, real
            phone" trust play. Switched to object-fit:contain so the
            FULL sign reads end-to-end. Existing top + side gradient
            overlays cover the vertical letterbox elegantly. */}
        <img
          src="/brand-sign.webp"
          alt="Nick's Tire & Auto signage on Euclid Ave Cleveland — Mechanic on duty, tires, brakes, auto repair, (216) 862-0005"
          className="absolute inset-0 w-full h-full object-contain"
          style={{ objectPosition: "center center" }}
          loading="lazy"
        />
        {/* Bottom-fade for legibility of the overlay copy */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0B] via-[#0B0B0B]/40 to-transparent" />
        {/* Side-fade pulls focus to the center where the eye lands */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B0B0B]/60 via-transparent to-[#0B0B0B]/60" />

        {/* Voice overlay — bottom-left, doesn't fight the sign */}
        <div className="absolute inset-0 flex items-end">
          <div className="container pb-6 sm:pb-8 lg:pb-10">
            <div className="max-w-2xl">
              <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.22em] font-bold text-[#FDB913] mb-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                The block · The bay · The phone
              </p>
              <h3 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight uppercase leading-[1.05] drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">
                Don't trust shops you can't see.
              </h3>
              <p className="mt-2 sm:mt-3 text-white/75 text-sm sm:text-base leading-snug drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                That's our actual sign. Our actual block. Our actual number. The yellow's a little louder in person.
              </p>
              <p className="mt-3 text-white/55 text-xs sm:text-sm font-medium drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                {BUSINESS.address.full} · open 7 days · walk-ins welcome
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ─── TOP CTA STRIPE ─── */}
      <div className="bg-[#FDB913] py-3.5">
        <div className="container text-center">
          <p className="text-black text-sm sm:text-base font-semibold">
            Car acting up? We can usually fix it same day.{" "}
            <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick("footer-stripe")} className="underline hover:no-underline">
              Call {BUSINESS.phone.display}
            </a>{" "}
            <span className="sm:hidden">
              {" "}or{" "}
              <a href={`sms:${BUSINESS.phone.raw}`} onClick={() => trackEvent("sms_click", { source: "footer-stripe" })} className="underline hover:no-underline">
                Text Us
              </a>
            </span>
            {" "}or{" "}
            <Link href="/booking" className="underline hover:no-underline">
              Schedule Drop-Off
            </Link>
          </p>
        </div>
      </div>

      {/* 2026-05-19 · Elon move #3 · EmailNewsletterCapture band removed.
          Low-conversion email capture (no measurable campaign volume) ·
          the gold CTA strip above + sticky mobile bar carry the actual
          conversion signal. The component file stays for restore-ability. */}

      {/* ─── MAIN FOOTER ─── */}
      <div className="bg-[#080808] border-t border-[#2A2A2A]">
        <div className="container py-16 lg:py-20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 lg:gap-8">
            {/* ─── COL 1: BRAND ─── */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-start gap-3 mb-2">
                <BrandMark variant="full" size={64} />
                <span className="text-[#FDB913] font-bold text-[17px] tracking-[-0.02em] pt-1">
                  Nick&apos;s Tire &amp; Auto
                </span>
              </div>
              <p className="mt-3 text-foreground/60 text-[13px] leading-relaxed max-w-[240px]">
                {BUSINESS.taglines.meme} Honest auto repair for Cleveland since 2018.
              </p>
              <p className="mt-3 text-foreground/60 text-[13px] leading-relaxed">
                {BUSINESS.address.full}
              </p>
              <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick("footer-brand")} className="block mt-1 text-foreground/60 hover:text-foreground/90 text-[13px] transition-colors duration-200">
                {BUSINESS.phone.display}
              </a>
              {/* Social links */}
              <div className="mt-5 flex gap-3">
                <a
                  href="https://www.instagram.com/nicks_tire_euclid/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/60 hover:text-foreground/90 transition-colors duration-200"
                  aria-label="Instagram"
                >
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                </a>
                <a
                  href="https://www.facebook.com/nickstireeuclid/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/60 hover:text-foreground/90 transition-colors duration-200"
                  aria-label="Facebook"
                >
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                </a>
                <a
                  href={GBP_REVIEW_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/60 hover:text-foreground/90 transition-colors duration-200"
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
                  { href: "/tires#tire-repair", label: "Tire Repair · $25" },
                  { href: "/brakes", label: "Brakes" },
                  { href: "/diagnostics", label: "Diagnostics" },
                  { href: "/emissions", label: "Emissions / E-Check" },
                  { href: "/oil-change", label: "Oil Change" },
                  { href: "/wheel-alignment-cleveland", label: "Wheel Alignment · $89" },
                  // 2026-08-19 · was /general-repair, a sitewide link to a 301.
                  { href: "/auto-repair-near-me", label: "General Repair" },
                  { href: "/ac-repair", label: "AC & Heating" },
                  { href: "/transmission", label: "Transmission" },
                  { href: "/electrical", label: "Electrical" },
                  { href: "/exhaust", label: "Exhaust & Muffler" },
                  { href: "/battery", label: "Battery Service" },
                  // wave-181.14 · footer link to new SERP-fix pages.
                  // Sitewide discoverability + crawler-friendly direct
                  // hrefs from every page that includes the footer (which
                  // is every public page).
                  { href: "/no-credit-check-tires-cleveland", label: "Bad Credit? Tire Options" },
                  { href: "/tires#open-sundays", label: "Sunday Tire Shop" },
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
                  { href: "/guides", label: "Guides" },
                  { href: "/faq", label: "FAQ" },
                  { href: "/car-care-guide", label: "Car Care Guide" },
                  { href: "/diagnose", label: "Diagnose My Car" },
                  { href: "/financing", label: "Payment Programs" },
                  { href: "/specials", label: "Specials" },
                  // 2026-05-06 wave-34 · entry point to the comparison hub
                  // (14 honest competitor comparisons). Internal link gives
                  // Googlebot a crawl path beyond the sitemap and a real
                  // user-discoverable nav route.
                  { href: "/best-tire-shops-cleveland", label: "Compare Cleveland Tire Shops" },
                  { href: "/careers", label: "Careers" },
                  // 2026-08-19 · /estimate and /appointment are 301s
                  // (redirects.ts) — every page shipped links to redirects.
                  { href: "/pricing", label: "Pricing" },
                  { href: "/fleet", label: "Fleet" },
                  { href: "/booking", label: "Drop-Off Online" },
                  // 2026-08-19 · orphan adoption — these registry pages had
                  // ZERO static internal links anywhere on the site.
                  { href: "/warranties", label: "Warranties" },
                  { href: "/check-engine-light-diagnostic", label: "Check Engine Light" },
                  { href: "/tire-storage", label: "Tire Storage" },
                  { href: "/hybrid-ev-repair", label: "Hybrid & EV Repair" },
                  // 2026-10-07 · site crawl: /site-map had ZERO inbound links,
                  // so the one page built to link every other page was itself
                  // unreachable from any page. 16 sitemap URLs were orphans
                  // with it (11 tire-size pages, /wheels, /tire-rebates,
                  // /moes-tire-euclid, /muffler-shop-open-sunday-cleveland).
                  { href: "/site-map", label: "Site Map" },
                ].map((l) => (
                  <Link key={l.href} href={l.href} className={LINK_CLASS}>{l.label}</Link>
                ))}
              </div>
            </div>

            {/* ─── COL 4: AREAS SERVED (branched by region) ─── */}
            <div>
              <h4 className={HEADING_CLASS}>Areas Served</h4>
              <div className="space-y-4">
                {[
                  {
                    region: "East Side",
                    cities: [
                      { href: "/euclid-auto-repair", label: "Euclid" },
                      { href: "/east-cleveland-auto-repair", label: "East Cleveland" },
                      { href: "/south-euclid-auto-repair", label: "South Euclid" },
                      { href: "/richmond-heights-auto-repair", label: "Richmond Heights" },
                      { href: "/lyndhurst-auto-repair", label: "Lyndhurst" },
                      { href: "/cleveland-heights-auto-repair", label: "Cleveland Heights" },
                      { href: "/shaker-heights-auto-repair", label: "Shaker Heights" },
                    ],
                  },
                  {
                    region: "Lake County",
                    cities: [
                      { href: "/willoughby-auto-repair", label: "Willoughby" },
                      { href: "/mentor-auto-repair", label: "Mentor" },
                      { href: "/wickliffe", label: "Wickliffe" },
                    ],
                  },
                  {
                    region: "South & West",
                    cities: [
                      { href: "/parma-auto-repair", label: "Parma" },
                      { href: "/garfield-heights-auto-repair", label: "Garfield Heights" },
                      { href: "/maple-heights-auto-repair", label: "Maple Heights" },
                      { href: "/bedford-auto-repair", label: "Bedford" },
                      { href: "/strongsville-auto-repair", label: "Strongsville" },
                      { href: "/lakewood-auto-repair", label: "Lakewood" },
                    ],
                  },
                  {
                    region: "Greater Cleveland",
                    cities: [
                      { href: "/cleveland-auto-repair", label: "Cleveland" },
                      { href: "/warrensville-heights-auto-repair", label: "Warrensville Hts" },
                      { href: "/collinwood", label: "Collinwood" },
                    ],
                  },
                ].map((group) => (
                  <div key={group.region}>
                    <span className="text-[12px] font-medium text-foreground/70 block mb-1.5">{group.region}</span>
                    <div className="ml-0 space-y-1.5">
                      {group.cities.map((c) => (
                        <Link key={c.href} href={c.href} className={LINK_CLASS}>{c.label}</Link>
                      ))}
                    </div>
                  </div>
                ))}
                <Link href="/areas-served" className="block text-[11px] text-[#FDB913]/60 hover:text-[#FDB913] transition-colors mt-2">
                  View all service areas →
                </Link>
              </div>
            </div>
          </div>

          {/* ─── TRUST SIGNAL ROW (wave-181.21) ───
              Last-impression trust strip. Surfaces the 5 strongest credibility
              facts where every page-visit ends:
                · Google rating + review depth (highest-impact in NW Ohio)
                · Years in business (counters "is this a fly-by-night shop")
                · Open 7 days (differentiator vs Conrad's / Mavis closed Sun)
                · Walk-ins welcome (differentiator vs chain appointment model)
                · Mechanic-owned (differentiator vs corporate franchise)
              Mobile collapses to 2-col grid so labels stay readable. */}
          <div className="mt-16 pt-10 border-t border-[#2A2A2A]">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-6 md:gap-4">
              <a
                href={GBP_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col items-center text-center px-2 py-3 rounded-lg border border-[#1F1F1F] hover:border-[#FDB913]/30 hover:bg-[#FDB913]/[0.02] transition-all"
              >
                <div className="flex items-center gap-1 mb-1.5 text-[#FDB913]">
                  <Star className="w-3.5 h-3.5 fill-[#FDB913]" />
                  <Star className="w-3.5 h-3.5 fill-[#FDB913]" />
                  <Star className="w-3.5 h-3.5 fill-[#FDB913]" />
                  <Star className="w-3.5 h-3.5 fill-[#FDB913]" />
                  <Star className="w-3.5 h-3.5 fill-[#FDB913]" />
                </div>
                <span className="text-white text-[15px] font-bold tracking-[-0.01em]">
                  {reviewRating}★ · {reviewCountDisplay}
                </span>
                <span className="text-foreground/50 text-[10px] uppercase tracking-[0.12em] mt-1">
                  Google reviews
                </span>
              </a>
              <div className="flex flex-col items-center text-center px-2 py-3 rounded-lg border border-[#1F1F1F]">
                <span className="text-[#FDB913] text-[22px] font-extrabold leading-none mb-2">
                  {new Date().getFullYear() - 2018}+
                </span>
                <span className="text-white text-[13px] font-semibold tracking-[-0.005em]">
                  Years on Euclid Ave
                </span>
                <span className="text-foreground/50 text-[10px] uppercase tracking-[0.12em] mt-1">
                  Same crew · same shop
                </span>
              </div>
              <div className="flex flex-col items-center text-center px-2 py-3 rounded-lg border border-[#1F1F1F]">
                <span className="text-[#FDB913] text-[22px] font-extrabold leading-none mb-2">
                  7 days
                </span>
                <span className="text-white text-[13px] font-semibold tracking-[-0.005em]">
                  Open every day
                </span>
                <span className="text-foreground/50 text-[10px] uppercase tracking-[0.12em] mt-1">
                  Sun 9–4 · Mon–Sat 8–6
                </span>
              </div>
              <div className="flex flex-col items-center text-center px-2 py-3 rounded-lg border border-[#1F1F1F]">
                <span className="text-[#FDB913] text-[22px] font-extrabold leading-none mb-2">
                  No appt
                </span>
                <span className="text-white text-[13px] font-semibold tracking-[-0.005em]">
                  Walk-ins welcome
                </span>
                <span className="text-foreground/50 text-[10px] uppercase tracking-[0.12em] mt-1">
                  First-come, first-served
                </span>
              </div>
              <div className="flex flex-col items-center text-center px-2 py-3 rounded-lg border border-[#1F1F1F]">
                <span className="text-[#FDB913] text-[22px] font-extrabold leading-none mb-2">
                  Local
                </span>
                <span className="text-white text-[13px] font-semibold tracking-[-0.005em]">
                  Mechanic-owned
                </span>
                <span className="text-foreground/50 text-[10px] uppercase tracking-[0.12em] mt-1">
                  Not a chain
                </span>
              </div>
            </div>
          </div>

          {/* ─── BOTTOM BAR ─── */}
          <div className="mt-10 pt-6 border-t border-[#2A2A2A] flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-foreground/55 text-[12px]">
              &copy; {new Date().getFullYear()} Nick's Tire & Auto. All rights reserved.
            </p>
            <p className="text-foreground/55 text-[12px]">
              Honest auto repair for Cleveland since 2018
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
