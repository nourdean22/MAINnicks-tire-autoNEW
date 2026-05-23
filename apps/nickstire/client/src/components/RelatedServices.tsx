/**
 * RelatedServices — Reusable grid of related service cards with internal links.
 * Each service page uses this to cross-link to 3-4 related services,
 * boosting internal link equity and helping users discover more services.
 *
 * Usage:
 *   <RelatedServices current="brakes" related={["tires", "diagnostics", "alignment"]} />
 *
 * wave-110 — title + desc now derive from canonical @shared/services
 * SERVICES (single source of truth). Slug → icon mapping stays local
 * (visual concern). `alignment` lives in BESPOKE_EXTRAS — it's a real
 * route (AlignmentPage) not in canonical SERVICES.
 */

import { Link } from "wouter";
import { ArrowRight, Wrench, Shield, Gauge, Zap, Droplets, ThermometerSun, Snowflake } from "lucide-react";
import { SERVICES } from "@shared/services";

interface ServiceInfo {
  slug: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
}

// Slug → icon. Adding a new canonical service requires adding the
// icon here too (else falls back to Wrench).
const ICON_BY_SLUG: Record<string, React.ReactNode> = {
  tires: <Gauge className="w-5 h-5" />,
  brakes: <Shield className="w-5 h-5" />,
  diagnostics: <Zap className="w-5 h-5" />,
  emissions: <ThermometerSun className="w-5 h-5" />,
  "oil-change": <Droplets className="w-5 h-5" />,
  "general-repair": <Wrench className="w-5 h-5" />,
  "ac-repair": <Snowflake className="w-5 h-5" />,
  transmission: <Wrench className="w-5 h-5" />,
  electrical: <Zap className="w-5 h-5" />,
  battery: <Zap className="w-5 h-5" />,
  exhaust: <ThermometerSun className="w-5 h-5" />,
  cooling: <Droplets className="w-5 h-5" />,
  alignment: <Gauge className="w-5 h-5" />,
  "pre-purchase-inspection": <Shield className="w-5 h-5" />,
  "belts-hoses": <Gauge className="w-5 h-5" />,
  "starter-alternator": <Zap className="w-5 h-5" />,
};

// Display-friendly title overrides for the cross-link card UI. Canonical
// titles are UPPERCASE (e.g. "BRAKES") which is loud in this small format.
// These are short, punchy, Title Case versions for the cross-link grid only.
const TITLE_OVERRIDES: Record<string, string> = {
  brakes: "Brake Repair",
  diagnostics: "Check Engine Light",
  electrical: "Electrical Repair",
  exhaust: "Exhaust Repair",
  emissions: "Emissions & E-Check",
  "ac-repair": "AC & Heating",
  "oil-change": "Oil Change",
  "general-repair": "General Repair",
  "pre-purchase-inspection": "Pre-Purchase Inspection",
  "belts-hoses": "Belts & Hoses",
  "starter-alternator": "Starter & Alternator",
};

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const SERVICE_MAP: Record<string, ServiceInfo> = Object.fromEntries(
  SERVICES.map((svc) => [
    svc.slug,
    {
      slug: svc.slug,
      title: TITLE_OVERRIDES[svc.slug] || toTitleCase(svc.title),
      desc: svc.shortDesc,
      icon: ICON_BY_SLUG[svc.slug] || <Wrench className="w-5 h-5" />,
    },
  ])
);

// Bespoke services not in canonical SERVICES. AlignmentPage is the
// owner of /alignment content; this entry is the cross-link card form.
SERVICE_MAP.alignment = {
  slug: "alignment",
  title: "Wheel Alignment",
  desc: "Precision alignment to extend tire life and improve handling.",
  icon: ICON_BY_SLUG.alignment || <Gauge className="w-5 h-5" />,
};

/** Default related service mappings when no explicit list is provided */
const DEFAULT_RELATED: Record<string, string[]> = {
  tires: ["brakes", "alignment", "diagnostics", "oil-change"],
  brakes: ["tires", "diagnostics", "general-repair", "alignment"],
  diagnostics: ["emissions", "brakes", "electrical", "general-repair"],
  emissions: ["diagnostics", "oil-change", "general-repair", "exhaust"],
  "oil-change": ["tires", "brakes", "diagnostics", "general-repair"],
  "general-repair": ["brakes", "diagnostics", "ac-repair", "cooling"],
  "ac-repair": ["cooling", "electrical", "general-repair", "diagnostics"],
  transmission: ["diagnostics", "oil-change", "general-repair", "electrical"],
  electrical: ["battery", "starter-alternator", "diagnostics", "general-repair"],
  battery: ["starter-alternator", "electrical", "diagnostics", "general-repair"],
  exhaust: ["emissions", "general-repair", "diagnostics", "cooling"],
  cooling: ["general-repair", "belts-hoses", "diagnostics", "ac-repair"],
  alignment: ["tires", "brakes", "general-repair", "diagnostics"],
  "pre-purchase-inspection": ["diagnostics", "brakes", "tires", "general-repair"],
  "belts-hoses": ["cooling", "general-repair", "diagnostics", "oil-change"],
  "starter-alternator": ["battery", "electrical", "diagnostics", "general-repair"],
};

interface Props {
  /** The current service slug (excluded from the grid) */
  current: string;
  /** Explicit list of related service slugs. Falls back to DEFAULT_RELATED. */
  related?: string[];
  /** Section heading. Defaults to "Related Services" */
  title?: string;
}

export default function RelatedServices({ current, related, title = "Related Services" }: Props) {
  const slugs = related || DEFAULT_RELATED[current] || ["tires", "brakes", "diagnostics", "oil-change"];
  const services = slugs
    .filter((s) => s !== current && SERVICE_MAP[s])
    .slice(0, 4)
    .map((s) => SERVICE_MAP[s]);

  if (services.length === 0) return null;

  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-16 border-t border-border/30">
      <div className="container">
        <h3 className="text-xs font-semibold text-foreground/60 uppercase tracking-widest mb-2">
          {title}
        </h3>
        <p className="text-foreground/70 text-sm mb-8">
          Looking for another service? We handle it all under one roof.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {services.map((s) => (
            <Link
              key={s.slug}
              href={`/${s.slug}`}
              className="group block p-6 border border-border/20 rounded-xl hover:border-primary/30 transition-all"
            >
              <div className="text-primary/60 group-hover:text-primary transition-colors mb-3">
                {s.icon}
              </div>
              <h4 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors tracking-wide">
                {s.title}
              </h4>
              <p className="text-xs text-foreground/70 mt-2 leading-relaxed line-clamp-2">
                {s.desc}
              </p>
              <span className="inline-flex items-center gap-1 mt-3 text-xs text-foreground/60 group-hover:text-primary transition-colors">
                Learn more <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-4 text-xs text-foreground/70">
          {/* wave-110 — "financing" is a banned brand word; copy now uses
              "Payment programs." (link target /financing stays — that's the URL slug). */}
          <Link href="/financing" className="hover:text-primary transition-colors">Payment programs · Apply in 2 minutes · No credit check</Link>
          <span className="text-foreground/20">|</span>
          <Link href="/booking" className="hover:text-primary transition-colors">Schedule your drop-off online</Link>
          <span className="text-foreground/20">|</span>
          <Link href="/services" className="hover:text-primary transition-colors">View all services</Link>
        </div>
      </div>
    </section>
  );
}
