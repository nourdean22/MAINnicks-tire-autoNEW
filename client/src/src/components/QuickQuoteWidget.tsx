/**
 * QuickQuoteWidget — Instant price range + Acima CTA
 * Shows approximate cost for common services with lease-to-own option.
 * Positioned on Homepage after hero, before services grid.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Phone, CreditCard } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { ACIMA_COMPACT_DISCLOSURE, ACIMA_SOCIAL_PROOF, trackAcimaClick, buildAcimaUrl } from "@/lib/acima";

const SERVICES = [
  { label: "Oil Change", low: 39, high: 89 },
  { label: "Brake Repair", low: 189, high: 449 },
  { label: "4 New Tires (installed)", low: 400, high: 1200 },
  { label: "Wheel Alignment", low: 89, high: 129 },
  { label: "Check Engine Diagnostics", low: 89, high: 129 },
  { label: "Battery Replacement", low: 149, high: 289 },
  { label: "Alternator Replacement", low: 349, high: 649 },
  { label: "Starter Replacement", low: 299, high: 599 },
  { label: "Struts/Shocks (pair)", low: 399, high: 899 },
  { label: "A/C Repair", low: 149, high: 699 },
  { label: "Emissions / E-Check Repair", low: 150, high: 600 },
  { label: "General Repair", low: 100, high: 800 },
  { label: "TPMS Sensors", low: 50, high: 200 },
] as const;

export default function QuickQuoteWidget() {
  const [selected, setSelected] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const service = selected !== null ? SERVICES[selected] : null;

  return (
    <section className="py-12 bg-[oklch(0.055_0.004_260)]">
      <div className="container max-w-lg mx-auto">
        <div className="bg-card/40 border border-border/20 rounded-2xl p-6 sm:p-8">
          <h3 className="text-lg font-bold text-foreground tracking-tight text-center">
            What Would This Cost?
          </h3>
          <p className="text-sm text-foreground/50 text-center mt-1">
            Get an instant estimate — no call, no appointment
          </p>

          {/* Service dropdown */}
          <div className="relative mt-5">
            <button
              onClick={() => setOpen(!open)}
              className="w-full flex items-center justify-between bg-background border border-border/50 rounded-lg px-4 py-3 text-sm text-left hover:border-foreground/30 transition-colors"
            >
              <span className={service ? "text-foreground" : "text-foreground/40"}>
                {service ? service.label : "Choose a service..."}
              </span>
              <ChevronDown className={`w-4 h-4 text-foreground/40 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            <AnimatePresence>
              {open && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute z-10 w-full mt-1 bg-background border border-border/50 rounded-lg shadow-xl overflow-hidden"
                >
                  {SERVICES.map((s, i) => (
                    <button
                      key={s.label}
                      onClick={() => { setSelected(i); setOpen(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-foreground/5 transition-colors ${
                        selected === i ? "text-primary font-medium bg-primary/5" : "text-foreground/70"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Price result */}
          <AnimatePresence mode="wait">
            {service && (
              <motion.div
                key={service.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="mt-6"
              >
                <div className="text-center">
                  <p className="text-foreground/40 text-xs uppercase tracking-wider mb-1">Estimated Range</p>
                  <p className="text-3xl font-bold text-foreground tracking-tight">
                    ${service.low}–${service.high}
                  </p>
                </div>

                {/* Acima callout */}
                <a
                  href={buildAcimaUrl("quick_quote_widget")}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackAcimaClick("quick_quote_widget")}
                  className="block mt-4 bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-3 text-center hover:bg-emerald-500/10 transition-colors"
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">
                      Lease-to-own from $10 down with Acima
                    </span>
                  </div>
                  <p className="text-[9px] text-emerald-400/50 mt-1">{ACIMA_SOCIAL_PROOF}</p>
                  <p className="text-[9px] text-foreground/25 mt-0.5">{ACIMA_COMPACT_DISCLOSURE}</p>
                </a>

                {/* CTA buttons */}
                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  <a
                    href="#booking"
                    className="flex-1 flex items-center justify-center gap-2 bg-foreground text-background py-3 rounded-lg font-medium text-sm hover:bg-foreground/90 transition-colors"
                  >
                    Book Now
                  </a>
                  <a
                    href={BUSINESS.phone.href}
                    className="flex-1 flex items-center justify-center gap-2 border border-foreground/20 text-foreground py-3 rounded-lg font-medium text-sm hover:bg-foreground/5 transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    Get Exact Quote
                  </a>
                </div>

                <p className="text-[11px] text-foreground/30 text-center mt-3">
                  Estimates based on typical jobs. Final price depends on vehicle and parts needed.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
