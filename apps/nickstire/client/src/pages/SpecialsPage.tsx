/**
 * /specials — Specials & Coupons page
 * Hardcoded specials with price-anchoring, urgency badges, and booking CTAs.
 */

import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import {
  Phone, Tag, ChevronRight, Clock, AlertTriangle,
  Droplets, Disc3, ScanSearch, RotateCcw, Snowflake, Wind,
  CreditCard, Copy, Check, TrendingUp,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import FadeIn from "@/components/FadeIn";
import { useState } from "react";

/* ─── SPECIALS DATA ─────────────────────────────────────── */
interface Special {
  id: number;
  icon: React.ReactNode;
  service: string;
  headline: string;
  description: string;
  salePrice: string;
  originalPrice: string;
  discountLabel: string;
  validThrough: string;
  terms: string;
  limited?: boolean;
  // ── Conversion-overhaul fields ─────────────────────────────
  /** Single-line "why this offer exists" — reciprocity framing. */
  reasonWhy?: string;
  /** Comparison anchors — Dealer / Chain / Nick's. Defensible numbers only. */
  anchors?: { dealer?: string; chain?: string; nicks: string };
  /** Service slug for deep-linking the booking CTA. */
  serviceSlug?: string;
  /** Coupon-style code visitors can mention or copy. */
  code?: string;
  /** "Cost of waiting" tie-in — one-liner. Used for major-repair specials. */
  waitingCost?: string;
  // ── Surface active coupons extensions ─────────────────────
  isFeatured?: boolean;
  badgeText?: string;
}

const SPECIALS: Special[] = [
  {
    id: 1,
    icon: <Droplets className="w-6 h-6" />,
    service: "Oil Change",
    headline: "Conventional Oil Change",
    description:
      "Full conventional oil change with new filter. Includes the free 27-point 20-point check that keeps small problems from becoming repair bills.",
    salePrice: "$29.99",
    originalPrice: "$49.99",
    discountLabel: "$20 OFF",
    validThrough: "April 30, 2026",
    terms: "Conventional oil only. Up to 5 quarts. Synthetic blend +$15, full synthetic +$30. Most vehicles.",
    limited: true,
    reasonWhy: "We treat oil changes as the front door of the relationship. Cheap entry point, real check, no upsell pressure.",
    anchors: { dealer: "$79", chain: "$49–$59", nicks: "$29.99" },
    serviceSlug: "oil-change",
    code: "OIL2999",
  },
  {
    id: 2,
    icon: <Disc3 className="w-6 h-6" />,
    service: "Brake Pads",
    headline: "Economy Brake Pads (per axle)",
    description:
      "New economy brake pads installed, plus rotor check and full brake-system check. We show you the worn pads before we replace them.",
    salePrice: "$129",
    originalPrice: "$179",
    discountLabel: "$50 OFF",
    validThrough: "April 30, 2026",
    terms: "Per axle. Economy pads. Rotor resurface +$40/axle, rotor replacement extra. Most cars and light trucks.",
    reasonWhy: "Brake pads on metal is one of the cheapest repairs to catch early — and one of the most expensive to ignore.",
    anchors: { dealer: "$229", chain: "$179", nicks: "$129" },
    serviceSlug: "brakes",
    code: "BRAKE129",
    waitingCost: "Wait 30 days = scored rotors (+$120/axle); 60 days = warped caliper (+$300+).",
  },
  {
    id: 3,
    icon: <ScanSearch className="w-6 h-6" />,
    service: "Diagnostic Scan",
    headline: "Free Diagnostic Scan",
    description:
      "Check-engine light on? Free OBD-II code scan with any repair over $200. See exactly what's wrong before you spend a dollar — no commitment to fix.",
    salePrice: "FREE",
    originalPrice: "$89.99",
    discountLabel: "FREE",
    validThrough: "April 30, 2026",
    terms: "With any repair totaling $200+. Standard code scan; deeper checks (live data, wiring, intermittent) quoted at $95/hr if needed.",
    limited: true,
    reasonWhy: "We'd rather check for free and earn the repair than charge $90 to read codes you can get at AutoZone.",
    anchors: { dealer: "$120–$150", chain: "$89", nicks: "FREE" },
    serviceSlug: "diagnostics",
    code: "FREESCAN",
  },
  {
    id: 4,
    icon: <RotateCcw className="w-6 h-6" />,
    service: "Tire Rotation",
    headline: "Tire Rotation",
    description:
      "Pro 4-tire rotation, pressure check, and visual check. Extends tire life by ~20% when done every 5,000–7,500 miles.",
    salePrice: "$19.99",
    originalPrice: "$39.99",
    discountLabel: "50% OFF",
    validThrough: "April 30, 2026",
    terms: "Standard 4-tire rotation. Tire balancing +$10/tire if needed. TPMS reset included.",
    reasonWhy: "Rotations should be the cheapest line item in your maintenance budget — we keep it that way to remove the excuse to skip it.",
    anchors: { dealer: "$45", chain: "$25–$30", nicks: "$19.99" },
    serviceSlug: "tires",
    code: "ROTATE2099",
  },
  {
    id: 5,
    icon: <Wind className="w-6 h-6" />,
    service: "AC Check",
    headline: "AC System Check",
    description:
      "Refrigerant pressure check + visual component inspection. Catch low charge, leaks, or compressor wear before Cleveland's first 90° day.",
    salePrice: "$49.99",
    originalPrice: "$89.99",
    discountLabel: "$40 OFF",
    validThrough: "May 31, 2026",
    terms: "Check only — refrigerant recharge ($90+) and component repairs additional. R-1234yf vehicles quoted separately.",
    limited: true,
    reasonWhy: "AC issues caught in spring are 60% cheaper than the same issue caught in July. Easy seasonal incentive.",
    anchors: { dealer: "$130", chain: "$89", nicks: "$49.99" },
    serviceSlug: "ac-repair",
    code: "AC4999",
    waitingCost: "Wait until July = compressor more likely to fail under load (+$700–$1,400 vs. $90 recharge).",
  },
  {
    id: 6,
    icon: <Snowflake className="w-6 h-6" />,
    service: "Winter Prep",
    headline: "Winter Prep Package",
    description:
      "Battery load test, coolant strength check, brake check, and full tire eval. The four things that strand Cleveland drivers every January.",
    salePrice: "$99",
    originalPrice: "$159",
    discountLabel: "$60 OFF",
    validThrough: "December 31, 2026",
    terms: "Check-only package. Battery, coolant flush, brakes, or tire replacement quoted separately if needed.",
    reasonWhy: "Most January tow calls are October-knowable problems. We'd rather catch them in your driveway than on I-90.",
    anchors: { dealer: "$199", chain: "$129–$149", nicks: "$99" },
    serviceSlug: "general-repair",
    code: "WINTER99",
  },
];

/* ─── COPY-CODE CHIP ────────────────────────────────────── */
function CodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — silently noop */
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 border border-primary/30 text-primary text-[11px] font-mono font-bold tracking-wider hover:bg-primary/15 transition-colors"
      aria-label={`Copy code ${code}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {code}
    </button>
  );
}

/* ─── SPECIAL CARD ──────────────────────────────────────── */
function SpecialCard({ special }: { special: Special }) {
  const ctaHref = special.serviceSlug
    ? `/booking?service=${encodeURIComponent(special.serviceSlug)}`
    : "/booking";

  return (
    <div className="relative bg-[#141414] border border-[#2A2A2A] rounded-xl overflow-hidden hover:border-primary/40 transition-colors flex flex-col">
      {/* Limited badge */}
      {(special.limited || special.badgeText) && (
        <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-red-500/15 text-red-400 text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
          <AlertTriangle className="w-3 h-3" />
          {special.badgeText || "Seasonal"}
        </div>
      )}

      <div className="p-6 lg:p-7 flex flex-col flex-1">
        {/* Icon + service label */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center text-primary">
            {special.icon}
          </div>
          <span className="text-foreground/50 text-xs font-bold uppercase tracking-widest">
            {special.service}
          </span>
        </div>

        {/* Discount amount in gold */}
        <div className="font-heading text-3xl lg:text-4xl font-bold text-primary tracking-tight mb-1">
          {special.discountLabel}
        </div>

        {/* Title */}
        <h3 className="font-heading font-bold text-white text-lg uppercase tracking-wide mb-3">
          {special.headline}
        </h3>

        {/* Price */}
        <div className="flex items-baseline gap-3 mb-3">
          <span className="font-heading text-3xl font-bold text-white">{special.salePrice}</span>
          {special.originalPrice && special.salePrice !== "FREE" && (
            <span className="text-foreground/40 text-lg line-through">{special.originalPrice}</span>
          )}
        </div>

        {/* Comparison anchors — Dealer / Chain / Nick's */}
        {special.anchors && (
          <div className="grid grid-cols-3 gap-1.5 mb-4 text-[11px]">
            {special.anchors.dealer && (
              <div className="bg-[#0E0E0E] border border-[#2A2A2A] rounded-md p-2 text-center">
                <div className="text-foreground/35 uppercase tracking-wider font-bold mb-0.5">Dealer</div>
                <div className="text-foreground/55 line-through">{special.anchors.dealer}</div>
              </div>
            )}
            {special.anchors.chain && (
              <div className="bg-[#0E0E0E] border border-[#2A2A2A] rounded-md p-2 text-center">
                <div className="text-foreground/35 uppercase tracking-wider font-bold mb-0.5">Chain</div>
                <div className="text-foreground/55 line-through">{special.anchors.chain}</div>
              </div>
            )}
            <div className="bg-primary/10 border border-primary/30 rounded-md p-2 text-center">
              <div className="text-primary uppercase tracking-wider font-bold mb-0.5">Nick's</div>
              <div className="text-primary font-bold">{special.anchors.nicks}</div>
            </div>
          </div>
        )}

        {/* Description */}
        <p className="text-foreground/60 text-sm leading-relaxed mb-3">
          {special.description}
        </p>

        {/* Reason why (reciprocity framing) */}
        {special.reasonWhy && (
          <p className="text-foreground/45 text-xs italic mb-3 leading-relaxed border-l-2 border-primary/30 pl-3">
            "{special.reasonWhy}"
          </p>
        )}

        {/* Cost of waiting (loss-aversion tie-in) */}
        {special.waitingCost && (
          <div className="bg-rose-500/[0.06] border border-rose-500/20 rounded-md p-2.5 mb-3 flex items-start gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-rose-400 mt-0.5 flex-shrink-0" />
            <p className="text-rose-200/80 text-[11px] leading-snug">{special.waitingCost}</p>
          </div>
        )}

        {/* Footer row — code + valid through */}
        <div className="flex items-center justify-between gap-2 mb-3 mt-auto">
          {special.code ? (
            <CodeChip code={special.code} />
          ) : (
            <div className="text-foreground/35 text-[11px]">Mention at checkout</div>
          )}
          <div className="flex items-center gap-1 text-foreground/40 text-[11px]">
            <Clock className="w-3 h-3" />
            Until {special.validThrough}
          </div>
        </div>

        {/* Fine print */}
        <p className="text-foreground/30 text-[11px] italic mb-4 leading-relaxed">
          {special.terms}
        </p>

        {/* CTA — books with prefilled service */}
        <Link
          href={ctaHref}
          className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
        >
          BOOK THIS DEAL
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

const ICON_MAP: Record<string, React.ReactNode> = {
  oil: <Droplets className="w-6 h-6" />,
  brakes: <Disc3 className="w-6 h-6" />,
  diagnostic: <ScanSearch className="w-6 h-6" />,
  tires: <RotateCcw className="w-6 h-6" />,
  cooling: <Wind className="w-6 h-6" />,
  winter: <Snowflake className="w-6 h-6" />,
};

function mapDbSpecial(s: any, idx: number): Special {
  const val = s.discountValue ? parseFloat(s.discountValue) : 0;
  const label = s.discountType === "percent" ? `${val}% OFF` : s.discountType === "free_service" ? "FREE" : val > 0 ? `$${val} OFF` : "SPECIAL";
  // Map serviceCategory → /booking?service= slug. Best-effort.
  const slugMap: Record<string, string> = {
    oil: "oil-change",
    brakes: "brakes",
    diagnostic: "diagnostics",
    tires: "tires",
    cooling: "ac-repair",
    winter: "general-repair",
  };
  return {
    id: idx + 100,
    icon: ICON_MAP[s.serviceCategory || ""] || <Tag className="w-6 h-6" />,
    service: s.serviceCategory || "Special",
    headline: s.title,
    description: s.description || "",
    salePrice: label === "FREE" ? "FREE" : `$${val}`,
    originalPrice: "",
    discountLabel: label,
    validThrough: s.expiresAt
      ? new Date(s.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : "While supplies last",
    terms: s.couponCode ? `Use code: ${s.couponCode}` : "See store for details.",
    limited: s.discountType === "free_service",
    serviceSlug: slugMap[s.serviceCategory || ""] || undefined,
    code: s.couponCode || undefined,
  };
}

type DbCoupon = NonNullable<RouterOutputs["coupons"]["active"]>[number];

export function mapDbCouponToSpecial(c: DbCoupon, idx: number): Special {
  const val = c.discountValue ?? 0;
  const label = c.discountType === "percent" ? `${val}% OFF` : c.discountType === "free" ? "FREE" : val > 0 ? `$${val} OFF` : "COUPON";

  // Determine icon based on applicableServices description
  const servicesLower = (c.applicableServices || "").toLowerCase();
  let icon: React.ReactNode = <Tag className="w-6 h-6" />;
  if (servicesLower.includes("oil")) {
    icon = ICON_MAP.oil;
  } else if (servicesLower.includes("brake")) {
    icon = ICON_MAP.brakes;
  } else if (servicesLower.includes("diag")) {
    icon = ICON_MAP.diagnostic;
  } else if (servicesLower.includes("tire")) {
    icon = ICON_MAP.tires;
  } else if (servicesLower.includes("ac") || servicesLower.includes("cool") || servicesLower.includes("air")) {
    icon = ICON_MAP.cooling;
  } else if (servicesLower.includes("winter")) {
    icon = ICON_MAP.winter;
  }

  const remaining = c.maxRedemptions > 0 ? c.maxRedemptions - (c.currentRedemptions ?? 0) : 0;
  const badgeText = remaining > 0 ? `${remaining} LEFT` : undefined;

  return {
    id: idx + 200, // ensure unique key space
    icon,
    service: c.applicableServices === "all" ? "Any Service" : c.applicableServices,
    headline: c.title,
    description: c.description || "",
    salePrice: "COUPON",
    originalPrice: "",
    discountLabel: label,
    validThrough: c.expiresAt
      ? new Date(c.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : c.maxRedemptions === 0
        ? "Available now"
        : "While supplies last",
    terms: c.terms || "Mention at checkout.",
    limited: remaining > 0,
    badgeText,
    isFeatured: c.isFeatured === 1,
    code: c.code || undefined,
  };
}

/* ─── MAIN PAGE ─────────────────────────────────────────── */
export default function SpecialsPage() {
  const { data: dbSpecials } = trpc.specials.getActive.useQuery(undefined, { staleTime: 60_000 });
  const { data: dbCoupons } = trpc.coupons.active.useQuery(undefined, { staleTime: 60_000 });

  const specials = useMemo(() => {
    // Filter out expired hardcoded specials.
    const now = new Date();
    const activeHardcoded = SPECIALS.filter((s) => {
      const expires = new Date(s.validThrough);
      return isNaN(expires.getTime()) || expires >= now;
    });

    // Conversion-overhaul note: previously, when the DB had ≥3 active rows,
    // we replaced the hardcoded list entirely. That suppressed the rich
    // anchor / reasonWhy / waitingCost / serviceSlug / code data baked into
    // the hardcoded SPECIALS — the entire Batch 6 conversion frame.
    //
    // New rule: ALWAYS show the hardcoded conversion-framed offers, then
    // append any DB rows whose serviceCategory we don't already cover.
    // Admin keeps the power to add new offers, the visual hierarchy is
    // preserved, and the conversion architecture stays in front.
    const fromDb = (dbSpecials || []).map((s: any, i: number) => mapDbSpecial(s, i));
    const coveredServices = new Set(
      activeHardcoded.map((s) => s.service.toLowerCase())
    );
    const dbExtras = fromDb.filter(
      (s: Special) => !coveredServices.has(String(s.service).toLowerCase())
    );

    const fromCoupons = (dbCoupons || []).map((c: any, i: number) => mapDbCouponToSpecial(c, i));
    const featuredCoupons = fromCoupons.filter((c: any) => c.isFeatured);
    const regularCoupons = fromCoupons.filter((c: any) => !c.isFeatured);

    return [...featuredCoupons, ...activeHardcoded, ...dbExtras, ...regularCoupons];
  }, [dbSpecials, dbCoupons]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title="Nick's Tire & Auto Specials · Cleveland Auto Repair Coupons"
        description="Save on your next auto service with coupons & specials at Nick's Tire & Auto in Cleveland. Current deals on oil changes, brakes, tires, and check engine lights."
        canonicalPath="/specials"
      />

      {/* ── HERO ─────────────────────────────────────────── */}
      <section className="relative pt-32 lg:pt-40 pb-16 lg:pb-20 bg-[#0A0A0A]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--color-nick-yellow)_0%,_transparent_60%)] opacity-20" />
        <div className="relative container">
          <Breadcrumbs items={[{ label: "Specials & Coupons" }]} />
          <LocalBusinessSchema />
          <FadeIn>
            <div className="flex items-center gap-3 mb-4">
              <Tag className="w-6 h-6 text-primary" />
              <span className="text-primary text-sm font-bold tracking-widest uppercase">
                Current Offers
              </span>
            </div>
            <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-7xl text-white uppercase tracking-tight leading-[0.95]">
              Specials &<br />
              <span className="text-primary">Coupons</span>
            </h1>
            <p className="mt-6 text-foreground/70 text-lg max-w-2xl leading-relaxed">
              Honest auto repair at fair prices — plus these current specials. Mention any offer when
              you call or show it on your phone at the shop.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ── SPECIALS GRID ────────────────────────────────── */}
      <section className="py-12 lg:py-20 bg-[#0D0D0D]">
        <div className="container">
          <FadeIn>
            <h2 className="font-heading font-bold text-3xl lg:text-5xl text-white uppercase tracking-tight mb-10">
              Save on Your Next Repair
            </h2>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {specials.map((s: any, i: number) => (
              <FadeIn key={s.id} delay={i * 0.05}>
                <SpecialCard special={s} />
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── STACK WITH FINANCING ────────────────────────── */}
      <section className="py-10 lg:py-14 bg-[#0D0D0D]">
        <div className="container max-w-4xl">
          <FadeIn>
            <div className="bg-gradient-to-r from-primary/[0.07] via-primary/[0.03] to-transparent border border-primary/30 rounded-2xl p-6 lg:p-8">
              <div className="flex items-start gap-4 flex-col sm:flex-row">
                <div className="w-12 h-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-primary font-bold mb-1">Pro tip</div>
                  <h3 className="font-heading text-xl lg:text-2xl font-bold text-white uppercase tracking-tight mb-2">
                    Stack any deal with $10-down financing.
                  </h3>
                  <p className="text-foreground/65 text-sm leading-relaxed mb-4">
                    The discount applies first, then you finance the remainder. Soft credit pre-qualification takes 60 seconds with no impact on your score — see what you'd qualify for before deciding.
                  </p>
                  <Link
                    href="/financing"
                    className="inline-flex items-center gap-2 text-primary font-bold text-sm hover:underline"
                  >
                    See $10-down options
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── HOW TO REDEEM ────────────────────────────────── */}
      <section className="py-16 lg:py-20 bg-[#0A0A0A]">
        <div className="container">
          <FadeIn>
            <h2 className="font-heading font-bold text-3xl lg:text-4xl text-white uppercase tracking-tight text-center">
              How to <span className="text-primary">Redeem</span>
            </h2>
          </FadeIn>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              {
                num: "01",
                title: "Choose Your Deal",
                desc: "Browse the specials above and find the one that fits your needs.",
              },
              {
                num: "02",
                title: "Drop-Off or Call",
                desc: "Click \"Claim This Offer\" to schedule a drop-off, or call and mention the special.",
              },
              {
                num: "03",
                title: "Save Money",
                desc: "The discount is applied to your service. No hidden fees, no catches.",
              },
            ].map((step, i) => (
              <FadeIn key={step.num} delay={i * 0.1}>
                <div className="text-center">
                  <span className="font-heading font-bold text-5xl text-primary/20">
                    {step.num}
                  </span>
                  <h3 className="font-heading font-bold text-white text-lg tracking-wide mt-2 uppercase">
                    {step.title}
                  </h3>
                  <p className="text-foreground/60 mt-2 leading-relaxed">{step.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="py-16 lg:py-20 bg-[#0D0D0D]">
        <div className="container text-center">
          <FadeIn>
            <h2 className="font-heading font-bold text-3xl lg:text-5xl text-white uppercase tracking-tight">
              Ready to <span className="text-primary">Save</span>?
            </h2>
            <p className="mt-4 text-foreground/70 text-lg max-w-xl mx-auto">
              Call us or schedule a drop-off online. Mention any special and we will apply
              the discount.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick("specials_cta")}
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-bold text-lg tracking-wide hover:opacity-90 transition-colors"
              >
                <Phone className="w-5 h-5" />
                {BUSINESS.phone.display}
              </a>
              <Link
                href="/booking"
                className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 rounded-md font-bold text-lg tracking-wide hover:border-primary hover:text-primary transition-colors"
              >
                SCHEDULE DROP-OFF
                <ChevronRight className="w-5 h-5" />
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

    </PageLayout>
  );
}
