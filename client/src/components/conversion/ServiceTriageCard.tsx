/**
 * ServiceTriageCard — the card pattern that replaces the homepage service grid.
 *
 * Per the conversion-overhaul spec:
 *   ICON → SYMPTOM TRIGGER → CONSEQUENCE → IMMEDIATE-RELIEF CTA
 *
 * Each card frames a service as a triage decision: "if you have THIS symptom,
 * you have THIS amount of time before THIS catastrophe — book NOW to avoid it."
 *
 * Used on: homepage hero grid, service-page sidebars, blog post related-services.
 */
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

interface Props {
  /** Lucide icon component to display in the corner. */
  icon: React.ReactNode;
  /** Symptom phrasing — what the customer is experiencing.
   *  e.g., "GRINDING OR SQUEALING?" */
  symptom: string;
  /** Consequence — quantified pain, ideally in dollars/time/risk.
   *  e.g., "You're destroying your rotors at $3.50 per stop" */
  consequence: string;
  /** Relief — what we offer, with price/time anchor.
   *  e.g., "Same-day fix from $149" */
  relief: string;
  /** CTA label (action verb led).
   *  e.g., "STOP THE DAMAGE NOW" */
  ctaLabel: string;
  /** Service-page route. */
  ctaHref: string;
  /** Tone hint — affects accent color.
   *  - "danger" (red) = catastrophic risk
   *  - "warning" (amber) = compounding damage
   *  - "info" (primary blue/yellow) = preventive */
  tone?: "danger" | "warning" | "info";
}

const TONES = {
  danger: {
    border: "border-red-500/30",
    bg: "bg-red-500/[0.04]",
    accent: "text-red-400",
    btn: "bg-red-500 text-white hover:bg-red-600",
  },
  warning: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/[0.04]",
    accent: "text-amber-400",
    btn: "bg-amber-500 text-background hover:bg-amber-600",
  },
  info: {
    border: "border-primary/30",
    bg: "bg-primary/[0.04]",
    accent: "text-primary",
    btn: "bg-primary text-primary-foreground hover:bg-primary/90",
  },
};

export default function ServiceTriageCard({
  icon,
  symptom,
  consequence,
  relief,
  ctaLabel,
  ctaHref,
  tone = "info",
}: Props) {
  const t = TONES[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4 }}
      className={`group relative overflow-hidden rounded-lg border ${t.border} ${t.bg} p-5 hover:shadow-lg hover:shadow-primary/10 transition-shadow`}
    >
      <div className={`mb-4 inline-flex items-center justify-center rounded-md p-2 ${t.bg} ring-1 ${t.border}`}>
        <span className={t.accent}>{icon}</span>
      </div>

      <div className={`text-[11px] font-bold tracking-widest ${t.accent} uppercase mb-1.5`}>
        {symptom}
      </div>

      <p className="text-base font-semibold text-foreground/90 mb-2 leading-snug">
        {consequence}
      </p>

      <p className="text-sm text-foreground/60 mb-4 leading-relaxed">
        {relief}
      </p>

      <Link
        href={ctaHref}
        className={`inline-flex w-full items-center justify-center gap-1.5 rounded px-3 py-2.5 text-xs font-bold tracking-wide transition-colors ${t.btn}`}
      >
        {ctaLabel}
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </motion.div>
  );
}
