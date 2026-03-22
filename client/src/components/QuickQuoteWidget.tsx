/**
 * QuickQuoteWidget — Instant price range + Acima CTA
 * Shows approximate cost for common services with lease-to-own option.
 * Positioned on Homepage after hero, before services grid.
 */

import { useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Phone, CreditCard } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { ACIMA_COMPACT_DISCLOSURE, ACIMA_SOCIAL_PROOF, trackAcimaClick } from "@/lib/acima";

const SERVICES = [
  { label: "Oil Change", low: 40, high: 90 },
  { label: "Brake Pads & Rotors", low: 250, high: 550 },
  { label: "Tire Set (4 tires, installed)", low: 400, high: 900 },
  { label: "Wheel Alignment", low: 80, high: 120 },
  { label: "Diagnostics", low: 49, high: 120 },
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
            Quick Price Estimate
          </h3>
          <p className="text-sm text-foreground/50 text-center mt-1">
            Select a service to see approximate pricing
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
                <div className="mt-4 bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-3 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">
                      Lease-to-own from $10 down with Acima
                    </span>
                  </div>
                  <p className="text-[9px] text-emerald-400/50 mt-1">{ACIMA_SOCIAL_PROOF}</p>
                  <p className="text-[9px] text-foreground/25 mt-0.5">{ACIMA_COMPACT_DISCLOSURE}</p>
                </div>

                {/* CTA buttons */}
                <div className="mt-4 flex gap-2">
                  <a
                    href={BUSINESS.phone.href}
                    className="flex-1 flex items-center justify-center gap-2 bg-foreground text-background py-3 rounded-lg font-medium text-sm hover:bg-foreground/90 transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    Get Exact Quote
                  </a>
                  <Link
                    href="/financing?utm_source=quick_quote"
                    onClick={() => trackAcimaClick("quick_quote")}
                    className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 text-white py-3 rounded-lg font-medium text-sm hover:bg-emerald-500 transition-colors"
                  >
                    $10 Down Options
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
