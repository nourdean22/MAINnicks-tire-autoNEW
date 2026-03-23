/**
 * PricingToggle — Phase 1.8: Pricing Transparency with Financing Toggle
 * Animated toggle between "Pay Today" and "Monthly" pricing views.
 * Includes a "Cost of Waiting" loss-aversion section below pricing cards.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, AlertTriangle, Star } from "lucide-react";
import { BUSINESS } from "@shared/business";

// ─── TYPES ──────────────────────────────────────────────

interface PricingTier {
  name: string;
  description: string;
  price: number;
  warranty: string;
  popular?: boolean;
}

interface PricingToggleProps {
  tiers: PricingTier[];
  serviceName: string;
  costOfWaitingText?: string;
}

// ─── ANIMATED PRICE ─────────────────────────────────────

function AnimatedPrice({ amount, isMonthly }: { amount: number; isMonthly: boolean }) {
  const displayPrice = isMonthly ? Math.ceil(amount / 12) : amount;

  return (
    <div className="flex items-baseline gap-1">
      <span className="text-foreground/50 text-xl">$</span>
      <AnimatePresence mode="wait">
        <motion.span
          key={`${displayPrice}-${isMonthly}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="text-4xl font-bold font-mono text-foreground"
        >
          {displayPrice}
        </motion.span>
      </AnimatePresence>
      <span className="text-foreground/50 text-sm">
        {isMonthly ? "/mo" : ""}
      </span>
    </div>
  );
}

// ─── PRICING CARD ───────────────────────────────────────

function PricingCard({
  tier,
  isMonthly,
}: {
  tier: PricingTier;
  isMonthly: boolean;
}) {
  return (
    <motion.div
      layout
      className={`relative bg-[#141414] border rounded-xl p-6 flex flex-col transition-colors duration-200 ${
        tier.popular
          ? "border-primary shadow-lg shadow-primary/10"
          : "border-[#2A2A2A] hover:border-primary/40"
      }`}
    >
      {/* Most Popular Badge */}
      {tier.popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 bg-primary text-primary-foreground text-xs font-bold tracking-wide px-3 py-1 rounded-full">
            <Star className="w-3 h-3 fill-current" />
            MOST POPULAR
          </span>
        </div>
      )}

      {/* Tier Name */}
      <h3 className="font-bold text-lg text-foreground mt-1">{tier.name}</h3>

      {/* Description */}
      <p className="text-foreground/60 text-sm mt-2 leading-relaxed flex-1">
        {tier.description}
      </p>

      {/* Price */}
      <div className="mt-4">
        <AnimatedPrice amount={tier.price} isMonthly={isMonthly} />
      </div>

      {/* Monthly Disclaimer */}
      {isMonthly && (
        <p className="text-foreground/40 text-[11px] mt-1">
          Actual terms vary. Subject to approval.
        </p>
      )}

      {/* Warranty */}
      <p className="text-foreground/50 text-xs mt-3">
        {tier.warranty}
      </p>

      {/* CTA */}
      <a
        href="#booking"
        className="mt-5 block text-center bg-primary text-primary-foreground font-bold text-sm tracking-wide py-3 rounded-md hover:opacity-90 transition-opacity"
      >
        Book This Service
      </a>
    </motion.div>
  );
}

// ─── TOGGLE SWITCH ──────────────────────────────────────

function ToggleSwitch({
  isMonthly,
  onToggle,
}: {
  isMonthly: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-4">
      <span
        className={`text-sm font-semibold transition-colors duration-200 ${
          !isMonthly ? "text-foreground" : "text-foreground/40"
        }`}
      >
        Pay Today
      </span>

      {/* iOS-style toggle */}
      <button
        onClick={onToggle}
        aria-label={isMonthly ? "Switch to pay today pricing" : "Switch to monthly pricing"}
        className={`relative w-14 h-8 rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
          isMonthly ? "bg-[#FDB913]" : "bg-[#2A2A2A]"
        }`}
      >
        <motion.div
          layout
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute top-1 w-6 h-6 rounded-full bg-white shadow-md"
          style={{ left: isMonthly ? "calc(100% - 1.75rem)" : "0.25rem" }}
        />
      </button>

      <div className="flex flex-col">
        <span
          className={`text-sm font-semibold transition-colors duration-200 ${
            isMonthly ? "text-foreground" : "text-foreground/40"
          }`}
        >
          Monthly
        </span>
        <span
          className={`text-[11px] transition-colors duration-200 ${
            isMonthly ? "text-foreground/50" : "text-foreground/30"
          }`}
        >
          with financing
        </span>
      </div>
    </div>
  );
}

// ─── COST OF WAITING ────────────────────────────────────

function CostOfWaiting({ text }: { text: string }) {
  return (
    <div className="mt-10 bg-[#F44336]/10 border border-[#F44336]/20 rounded-xl p-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-[#F44336]/15 flex items-center justify-center text-[#F44336] shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-foreground text-lg mb-2">
            What Happens If You Wait?
          </h3>
          <p className="text-foreground/70 text-sm leading-relaxed mb-4">
            {text}
          </p>
          <a
            href={BUSINESS.phone.href}
            className="inline-flex items-center gap-2 bg-[#F44336] text-white px-5 py-2.5 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-opacity"
          >
            <Phone className="w-4 h-4" />
            Call {BUSINESS.phone.display}
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────

export default function PricingToggle({
  tiers,
  serviceName,
  costOfWaitingText,
}: PricingToggleProps) {
  const [isMonthly, setIsMonthly] = useState(false);

  return (
    <section className="py-12">
      {/* Section Header */}
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground">
          {serviceName} Pricing
        </h2>
        <p className="text-foreground/50 text-sm mt-2">
          Transparent pricing. No hidden fees.
        </p>
      </div>

      {/* Toggle */}
      <div className="mb-8">
        <ToggleSwitch
          isMonthly={isMonthly}
          onToggle={() => setIsMonthly((prev) => !prev)}
        />
      </div>

      {/* Pricing Cards Grid */}
      <div
        className={`grid gap-6 ${
          tiers.length === 1
            ? "max-w-sm mx-auto"
            : tiers.length === 2
              ? "grid-cols-1 md:grid-cols-2 max-w-2xl mx-auto"
              : "grid-cols-1 md:grid-cols-3"
        }`}
      >
        {tiers.map((tier) => (
          <PricingCard key={tier.name} tier={tier} isMonthly={isMonthly} />
        ))}
      </div>

      {/* Cost of Waiting */}
      {costOfWaitingText && <CostOfWaiting text={costOfWaitingText} />}
    </section>
  );
}
