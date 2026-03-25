/**
 * Good-Better-Best Pricing Component
 * Per directive: "Educate on value without saying 'cheap is bad'"
 * Default: BETTER selected (anchoring effect)
 * BEST column: subtle cobalt glow border
 */

import { useState } from "react";
import { Link } from "wouter";
import { Shield, Star, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface PricingTier {
  label: string;
  price: string;
  warranty: string;
  parts: string;
  features?: string[];
}

interface PricingCategory {
  name: string;
  good: PricingTier;
  better: PricingTier;
  best: PricingTier;
}

const PRICING: PricingCategory[] = [
  {
    name: "Brakes",
    good: { label: "Budget Pads", price: "$89", warranty: "6 months", parts: "Economy pads", features: ["Brake pad replacement", "Visual rotor check", "Road test"] },
    better: { label: "OEM Pads", price: "$149", warranty: "12 months", parts: "OEM-spec pads", features: ["Brake pad replacement", "Rotor resurface", "Brake fluid top-off", "Road test"] },
    best: { label: "Cleveland-Proof", price: "$199", warranty: "36 months", parts: "Premium ceramic", features: ["Premium ceramic pads", "New rotors", "Brake fluid flush", "Hardware kit", "Road test", "36-month warranty"] },
  },
  {
    name: "Tires",
    good: { label: "Quality Used", price: "From $60", warranty: "30 days", parts: "Inspected used", features: ["Safety-inspected used tire", "Professional mounting", "Computer balancing"] },
    better: { label: "Budget New", price: "From $89", warranty: "Manufacturer", parts: "New economy tire", features: ["New economy tire", "Professional mounting", "Computer balancing", "Valve stems", "TPMS reset"] },
    best: { label: "Premium New", price: "From $129", warranty: "Road hazard", parts: "Name brand tire", features: ["Name brand tire", "Professional mounting", "Computer balancing", "Valve stems", "TPMS reset", "Alignment check", "Road hazard warranty"] },
  },
  {
    name: "Oil Change",
    good: { label: "Conventional", price: "$39", warranty: "3 months / 3K mi", parts: "Conventional oil", features: ["Conventional oil", "New filter", "20-point inspection"] },
    better: { label: "Synthetic Blend", price: "$59", warranty: "5 months / 5K mi", parts: "Synthetic blend", features: ["Synthetic blend oil", "Premium filter", "20-point inspection", "Fluid top-off"] },
    best: { label: "Full Synthetic", price: "$79", warranty: "6 months / 7.5K mi", parts: "Full synthetic", features: ["Full synthetic oil", "Premium filter", "20-point inspection", "All fluids topped", "Tire pressure set", "Battery test"] },
  },
];

function TierCard({ tier, level, selected, onSelect }: {
  tier: PricingTier;
  level: "good" | "better" | "best";
  selected: boolean;
  onSelect: () => void;
}) {
  const isBest = level === "best";

  return (
    <motion.button
      onClick={onSelect}
      className={`relative text-left p-6 rounded-2xl border transition-all duration-300 w-full ${
        selected
          ? isBest
            ? "border-secondary bg-secondary/5 shadow-[0_0_20px_rgba(30,77,140,0.3)]"
            : "border-primary/50 bg-primary/5"
          : "border-border hover:border-border/80 bg-transparent"
      }`}
      whileTap={{ scale: 0.98 }}
    >
      {isBest && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-secondary text-white">
          Best Value
        </span>
      )}

      <div className="mb-4">
        <h4 className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">
          {tier.label}
        </h4>
        <p className="text-xs text-muted-foreground mt-1">{tier.parts}</p>
      </div>

      <div className="mb-4">
        <span className="text-3xl font-bold text-primary font-mono">{tier.price}</span>
      </div>

      <div className="flex items-center gap-1.5 mb-4">
        <Shield className={`w-4 h-4 ${selected && isBest ? "text-secondary" : "text-muted-foreground"}`} />
        <span className="text-xs text-muted-foreground">{tier.warranty} warranty</span>
      </div>

      {tier.features && (
        <ul className="space-y-1.5">
          {tier.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-xs text-foreground/60">
              <Check className="w-3 h-3 text-[#27AE60] mt-0.5 shrink-0" />
              {f}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <span className={`inline-flex items-center justify-center w-full py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
          selected
            ? "btn-gold"
            : "bg-border/50 text-muted-foreground"
        }`}>
          {selected ? "Book This" : "Select"}
        </span>
      </div>
    </motion.button>
  );
}

export default function PricingTiers() {
  const [activeCategory, setActiveCategory] = useState(0);
  const [selectedTier, setSelectedTier] = useState<"good" | "better" | "best">("better");

  const category = PRICING[activeCategory];

  return (
    <section className="py-16 lg:py-24 section-elevated">
      <div className="container">
        <div className="text-center mb-12">
          <h2 className="font-heading text-3xl lg:text-4xl font-extrabold text-foreground uppercase tracking-tight">
            Transparent Pricing
          </h2>
          <p className="mt-3 text-muted-foreground text-lg max-w-md mx-auto">
            Three tiers. Same honest service. You choose what fits your budget.
          </p>
        </div>

        {/* Category Tabs */}
        <div className="flex justify-center gap-2 mb-10">
          {PRICING.map((cat, i) => (
            <button
              key={cat.name}
              onClick={() => { setActiveCategory(i); setSelectedTier("better"); }}
              className={`px-5 py-2 rounded-full text-sm font-bold uppercase tracking-wider transition-all ${
                i === activeCategory
                  ? "bg-primary text-[#0B0E14]"
                  : "bg-border/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Tier Cards */}
        <AnimatePresence mode="wait">
          <motion.div
            key={category.name}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto"
          >
            <TierCard tier={category.good} level="good" selected={selectedTier === "good"} onSelect={() => setSelectedTier("good")} />
            <TierCard tier={category.better} level="better" selected={selectedTier === "better"} onSelect={() => setSelectedTier("better")} />
            <TierCard tier={category.best} level="best" selected={selectedTier === "best"} onSelect={() => setSelectedTier("best")} />
          </motion.div>
        </AnimatePresence>

        {/* CTA */}
        <div className="mt-10 text-center">
          <Link href="/booking" className="btn-gold inline-flex items-center gap-2 text-base">
            Book {category.name} Service
          </Link>
          <p className="mt-3 text-muted-foreground text-xs">
            Free estimates on all services. No pressure — we show you the problem before we fix it.
          </p>
        </div>
      </div>
    </section>
  );
}
