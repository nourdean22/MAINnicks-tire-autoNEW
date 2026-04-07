/**
 * /specials — Specials & Coupons page
 * Hardcoded specials with price-anchoring, urgency badges, and booking CTAs.
 */

import { useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import {
  Phone, Tag, ChevronRight, Clock, AlertTriangle,
  Droplets, Disc3, ScanSearch, RotateCcw, Snowflake, Wind,
} from "lucide-react";
import { motion, useInView } from "framer-motion";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import { trpc } from "@/lib/trpc";

/* ─── FADE-IN HELPER ────────────────────────────────────── */
function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

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
}

const SPECIALS: Special[] = [
  {
    id: 1,
    icon: <Droplets className="w-6 h-6" />,
    service: "Oil Change",
    headline: "Conventional Oil Change",
    description:
      "Full conventional oil change with filter replacement. Includes a complimentary multi-point vehicle inspection.",
    salePrice: "$29.99",
    originalPrice: "$49.99",
    discountLabel: "$20 OFF",
    validThrough: "April 30, 2026",
    terms: "Conventional oil only. Up to 5 quarts. Synthetic blend or full synthetic available at additional cost.",
    limited: true,
  },
  {
    id: 2,
    icon: <Disc3 className="w-6 h-6" />,
    service: "Brake Pads",
    headline: "Economy Brake Pad Replacement",
    description:
      "New economy brake pads installed per axle. Includes rotor inspection and brake system check.",
    salePrice: "$129",
    originalPrice: "$179",
    discountLabel: "$50 OFF",
    validThrough: "April 30, 2026",
    terms: "Per axle. Economy pads only. Rotor resurfacing or replacement additional if needed. Most vehicles.",
  },
  {
    id: 3,
    icon: <ScanSearch className="w-6 h-6" />,
    service: "Diagnostic Scan",
    headline: "Free Diagnostic Scan",
    description:
      "Check engine light on? Get a free OBD-II diagnostic scan with any repair over $200. Know exactly what is wrong before you spend a dime.",
    salePrice: "FREE",
    originalPrice: "$89.99",
    discountLabel: "FREE",
    validThrough: "April 30, 2026",
    terms: "With any repair totaling $200 or more. Diagnostic scan only; advanced diagnostics may incur additional charges.",
    limited: true,
  },
  {
    id: 4,
    icon: <RotateCcw className="w-6 h-6" />,
    service: "Tire Rotation",
    headline: "Tire Rotation",
    description:
      "Extend tire life and improve handling with a professional 4-tire rotation. Includes tire pressure check and visual inspection.",
    salePrice: "$19.99",
    originalPrice: "$39.99",
    discountLabel: "50% OFF",
    validThrough: "April 30, 2026",
    terms: "Standard 4-tire rotation. Does not include tire balancing. TPMS reset included if applicable.",
  },
  {
    id: 5,
    icon: <Wind className="w-6 h-6" />,
    service: "AC Check",
    headline: "AC System Inspection",
    description:
      "Refrigerant level check and visual inspection of AC components. Stay cool this summer — catch problems before they leave you sweating.",
    salePrice: "$49.99",
    originalPrice: "$89.99",
    discountLabel: "$40 OFF",
    validThrough: "May 31, 2026",
    terms: "Includes refrigerant level check and visual inspection only. Refrigerant recharge and component repairs additional.",
    limited: true,
  },
  {
    id: 6,
    icon: <Snowflake className="w-6 h-6" />,
    service: "Winter Prep",
    headline: "Winter Prep Package",
    description:
      "Get your vehicle ready for Cleveland winters. Battery load test, coolant strength check, brake inspection, and full tire evaluation — all in one visit.",
    salePrice: "$99",
    originalPrice: "$159",
    discountLabel: "$60 OFF",
    validThrough: "December 31, 2026",
    terms: "Includes battery test, coolant check, visual brake inspection, and tire tread/pressure check. Repairs and parts additional.",
  },
];

/* ─── SPECIAL CARD ──────────────────────────────────────── */
function SpecialCard({ special }: { special: Special }) {
  return (
    <div className="relative bg-[#141414] border border-[#2A2A2A] rounded-xl overflow-hidden hover:border-primary/40 transition-colors flex flex-col">
      {/* Limited badge */}
      {special.limited && (
        <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-red-500/15 text-red-400 text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
          <AlertTriangle className="w-3 h-3" />
          Limited Availability
        </div>
      )}

      <div className="p-6 lg:p-8 flex flex-col flex-1">
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

        {/* Price anchoring */}
        <div className="flex items-baseline gap-3 mb-4">
          <span className="font-heading text-3xl font-bold text-white">{special.salePrice}</span>
          <span className="text-foreground/40 text-lg line-through">{special.originalPrice}</span>
        </div>

        {/* Description */}
        <p className="text-foreground/60 text-sm leading-relaxed mb-4 flex-1">
          {special.description}
        </p>

        {/* Valid through */}
        <div className="flex items-center gap-2 text-foreground/40 text-xs mb-4">
          <Clock className="w-3.5 h-3.5" />
          Valid through {special.validThrough}
        </div>

        {/* Fine print */}
        <p className="text-foreground/30 text-[11px] italic mb-5 leading-relaxed">
          {special.terms}
        </p>

        {/* CTA */}
        <Link
          href="/contact"
          className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-colors mt-auto"
        >
          CLAIM THIS OFFER
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
  return {
    id: idx + 100,
    icon: ICON_MAP[s.serviceCategory || ""] || <Tag className="w-6 h-6" />,
    service: s.serviceCategory || "Special",
    headline: s.title,
    description: s.description || "",
    salePrice: label === "FREE" ? "FREE" : `$${val}`,
    originalPrice: "",
    discountLabel: label,
    validThrough: s.expiresAt ? new Date(s.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "While supplies last",
    terms: s.couponCode ? `Use code: ${s.couponCode}` : "See store for details.",
    limited: s.discountType === "free_service",
  };
}

/* ─── MAIN PAGE ─────────────────────────────────────────── */
export default function SpecialsPage() {
  const { data: dbSpecials } = trpc.specials.getActive.useQuery(undefined, { staleTime: 60_000 });

  const specials = useMemo(() => {
    // Filter out expired hardcoded specials
    const now = new Date();
    const activeHardcoded = SPECIALS.filter((s) => {
      const expires = new Date(s.validThrough);
      return isNaN(expires.getTime()) || expires >= now;
    });

    if (dbSpecials && dbSpecials.length > 0) {
      // Merge: DB specials first, then active hardcoded fallbacks
      const fromDb = dbSpecials.map((s: any, i: number) => mapDbSpecial(s, i));
      return [...fromDb, ...activeHardcoded];
    }
    return activeHardcoded;
  }, [dbSpecials]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title="Specials & Coupons | Nick's Tire & Auto Cleveland"
        description="Save on auto repair at Nick's Tire & Auto in Cleveland. Current specials on oil changes, brakes, diagnostics, tires, AC service, and more."
        canonicalPath="/specials"
      />

      {/* ── HERO ─────────────────────────────────────────── */}
      <section className="relative pt-32 lg:pt-40 pb-16 lg:pb-20 bg-[#0A0A0A]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--nick-yellow-alpha)_0%,_transparent_60%)] opacity-20" />
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
            {specials.map((s, i) => (
              <FadeIn key={s.id} delay={i * 0.05}>
                <SpecialCard special={s} />
              </FadeIn>
            ))}
          </div>
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
                title: "Book or Call",
                desc: "Click \"Claim This Offer\" to book online, or call and mention the special.",
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
              Call us or book online to schedule your service. Mention any special and we will apply
              the discount.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick("specials_cta")}
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-bold text-lg tracking-wide hover:opacity-90 transition-colors"
              >
                <Phone className="w-5 h-5" />
                CALL NOW
              </a>
              <Link
                href="/contact"
                className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 rounded-md font-bold text-lg tracking-wide hover:border-primary hover:text-primary transition-colors"
              >
                BOOK ONLINE
                <ChevronRight className="w-5 h-5" />
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      <InternalLinks />
    </PageLayout>
  );
}
