/**
 * RelatedServices — Reusable grid of related service cards with internal links.
 * Each service page uses this to cross-link to 3-4 related services,
 * boosting internal link equity and helping users discover more services.
 *
 * Usage:
 *   <RelatedServices current="brakes" related={["tires", "diagnostics", "alignment"]} />
 */

import { Link } from "wouter";
import { ArrowRight, Wrench, Shield, Gauge, Zap, Droplets, ThermometerSun, Snowflake } from "lucide-react";

interface ServiceInfo {
  slug: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
}

const SERVICE_MAP: Record<string, ServiceInfo> = {
  tires: { slug: "tires", title: "Tires", desc: "New & used tires, mounting, balancing, TPMS, flat repair. All major brands at fair prices.", icon: <Gauge className="w-5 h-5" /> },
  brakes: { slug: "brakes", title: "Brake Repair", desc: "Pads, rotors, calipers, brake lines, ABS diagnostics. We show you the problem first.", icon: <Shield className="w-5 h-5" /> },
  diagnostics: { slug: "diagnostics", title: "Engine Diagnostics", desc: "Check engine light, OBD-II scanning, advanced computer diagnostics.", icon: <Zap className="w-5 h-5" /> },
  emissions: { slug: "emissions", title: "Emissions & E-Check", desc: "Ohio E-Check repair and testing. We fix the root cause so you pass the first time.", icon: <ThermometerSun className="w-5 h-5" /> },
  "oil-change": { slug: "oil-change", title: "Oil Change", desc: "Conventional and synthetic oil changes with filter and multi-point inspection.", icon: <Droplets className="w-5 h-5" /> },
  "general-repair": { slug: "general-repair", title: "General Repair", desc: "Suspension, steering, exhaust, cooling systems, belts, hoses, and more.", icon: <Wrench className="w-5 h-5" /> },
  "ac-repair": { slug: "ac-repair", title: "AC & Heating", desc: "AC diagnosis, refrigerant recharge, compressor repair, heater core service.", icon: <Snowflake className="w-5 h-5" /> },
  transmission: { slug: "transmission", title: "Transmission", desc: "Transmission diagnosis, fluid service, and repair. Shifting problems fixed right.", icon: <Wrench className="w-5 h-5" /> },
  electrical: { slug: "electrical", title: "Electrical Repair", desc: "Wiring, sensors, modules, and electrical system diagnostics.", icon: <Zap className="w-5 h-5" /> },
  battery: { slug: "battery", title: "Battery Service", desc: "Free battery testing. Quality replacement batteries with warranty.", icon: <Zap className="w-5 h-5" /> },
  exhaust: { slug: "exhaust", title: "Exhaust Repair", desc: "Muffler, catalytic converter, exhaust manifold repair and replacement.", icon: <ThermometerSun className="w-5 h-5" /> },
  cooling: { slug: "cooling", title: "Cooling System", desc: "Radiator, thermostat, water pump, coolant flush, and overheating repair.", icon: <Droplets className="w-5 h-5" /> },
  alignment: { slug: "alignment", title: "Wheel Alignment", desc: "Precision alignment to extend tire life and improve handling.", icon: <Gauge className="w-5 h-5" /> },
  "pre-purchase-inspection": { slug: "pre-purchase-inspection", title: "Pre-Purchase Inspection", desc: "Thorough used car inspection before you buy. Know what you're getting.", icon: <Shield className="w-5 h-5" /> },
  "belts-hoses": { slug: "belts-hoses", title: "Belts & Hoses", desc: "Timing belt, serpentine belt, radiator hoses — prevent breakdowns.", icon: <Gauge className="w-5 h-5" /> },
  "starter-alternator": { slug: "starter-alternator", title: "Starter & Alternator", desc: "Car won't start? We test and replace starters and alternators.", icon: <Zap className="w-5 h-5" /> },
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
          <Link href="/financing" className="hover:text-primary transition-colors">Need financing? Apply in 2 minutes</Link>
          <span className="text-foreground/20">|</span>
          <Link href="/booking" className="hover:text-primary transition-colors">Schedule your drop-off online</Link>
          <span className="text-foreground/20">|</span>
          <Link href="/services" className="hover:text-primary transition-colors">View all services</Link>
        </div>
      </div>
    </section>
  );
}
