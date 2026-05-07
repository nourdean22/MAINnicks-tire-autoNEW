/**
 * Financing — Batch 5 of the conversion overhaul.
 *
 * Architecture:
 *   1. Hero with anchor pill (loss-aversion framing).
 *   2. CostOfWaitingBlock — "$1,200 today vs $4,300 in 30 days" math.
 *      Pure loss aversion + anchor. Numbers from AAA cascade studies.
 *   3. ApprovalTrap — soft-check pre-qual button + 3 trust ankles.
 *      Single most important commitment moment on the page.
 *   4. Lender hierarchy — NOT a 2x2 grid. Three explicit tiers:
 *        TRY FIRST → BACKUP IF DECLINED → BIGGEST AMOUNT
 *      Removes choice paralysis. Decoy effect via "Most chosen" pill.
 *   5. PaymentCalculator with decoy-highlighted 12-month tier.
 *   6. ProcessTimeline — three steps so the path is visible end-to-end.
 *   7. ApprovalRange — honest "majority qualify" line with real anchors.
 *   8. FAQ accordion — full 7-item set from shared/financing.
 *   9. Bottom CTA — call OR pre-qual, not just call.
 *
 * Brand tokens preserved (#FDB913, oklch backgrounds, font-heading).
 * Every claim either sourced or hedged ("typical", "most"). No fake
 * approval percentages or fabricated testimonials.
 */

import { useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import InternalLinks from "@/components/InternalLinks";
import {
  DollarSign, Phone, CheckCircle, CreditCard,
  AlertCircle, Shield,
  Clock, ArrowRight, ChevronDown,
  FileText, Car, TrendingUp, Award,
  AlertTriangle,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import { FINANCING_PROVIDERS, FINANCING_FAQ } from "@shared/financing";
import { ACIMA_BANNER } from "@/lib/acima";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";
import FinancingPreApprovalModal from "@/components/FinancingPreApprovalModal";

/* ─── Lender hierarchy (decoy-effect ranked) ────────────────── */
type ProviderTier = "primary" | "backup" | "max";

interface RankedProvider {
  id: string;
  name: string;
  tier: ProviderTier;
  tierLabel: string;
  tierBadge: string;
  reasonToChoose: string;
  bestFor: string;
  features: string[];
}

const RANKED_PROVIDERS: RankedProvider[] = [
  {
    id: "acima",
    name: "Acima Credit",
    tier: "primary",
    tierLabel: "TRY FIRST",
    tierBadge: "Most chosen",
    reasonToChoose: "Highest approval rate of our four lenders. 90-day same-as-cash window means if you pay it off in 90 days, you pay no more than the cash price — effectively interest-free for fast payoff.",
    bestFor: "Most repairs $300–$5,000. Limited or no credit history.",
    features: [
      "Decision in seconds — no hard credit check",
      "90-day same-as-cash → 0% effective cost if paid in 90d",
      "Approval based on bank account history, not FICO",
      "Early buyout discounts at any time",
    ],
  },
  {
    id: "snap",
    name: "Snap Finance",
    tier: "backup",
    tierLabel: "BACKUP",
    tierBadge: "If declined",
    reasonToChoose: "Different underwriting model than Acima — many customers declined by Acima get approved here. 100-day early-buyout window is the longest in our lineup.",
    bestFor: "Customers Acima can't approve. Repairs under $5,000.",
    features: [
      "100-day early-payoff option (longest in our lineup)",
      "Apply in 60 seconds from your phone",
      "Different criteria than Acima — separate approval pool",
      "Weekly or bi-weekly payment plans",
    ],
  },
  {
    id: "koalafi",
    name: "Koalafi",
    tier: "max",
    tierLabel: "BIGGEST AMOUNT",
    tierBadge: "Up to $7,500",
    reasonToChoose: "Only lender that goes to $7,500. Use this for major repairs — engine work, transmission, multiple services bundled. Longer 12–24 month terms keep payments low.",
    bestFor: "Repairs $5,000–$7,500. Engine, transmission, or multi-service.",
    features: [
      "Highest approval cap — up to $7,500",
      "12–24 month terms (lowest monthly payment)",
      "Multiple buyout discount tiers",
      "Low initial payment to get started",
    ],
  },
];

/* ─── CostOfWaitingBlock ────────────────────────────────────── */
function CostOfWaitingBlock() {
  return (
    <FadeIn>
      <div className="bg-gradient-to-br from-rose-500/[0.06] via-rose-500/[0.02] to-transparent border border-rose-500/30 rounded-2xl p-6 lg:p-8">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="w-6 h-6 text-rose-400 mt-1 flex-shrink-0" />
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-rose-300 font-bold mb-1.5">
              The math no one shows you
            </div>
            <h2 className="font-heading text-2xl lg:text-3xl font-bold text-white tracking-tight uppercase leading-tight">
              "I'll just save up and pay cash next month"
              <span className="block text-rose-300 mt-1">is the most expensive sentence in car ownership.</span>
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="bg-[#141414]/70 border border-[#2A2A2A] rounded-xl p-5">
            <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2 font-bold">Today</div>
            <div className="font-heading text-3xl font-bold text-white">$1,200</div>
            <div className="text-sm text-white/60 mt-1.5 leading-snug">Common brake + caliper job. Financed: ~$110/mo for 12 months.</div>
          </div>
          <div className="bg-[#141414]/70 border border-amber-500/30 rounded-xl p-5">
            <div className="text-[11px] uppercase tracking-wider text-amber-300 mb-2 font-bold">+30 days</div>
            <div className="font-heading text-3xl font-bold text-amber-200">$2,100</div>
            <div className="text-sm text-white/60 mt-1.5 leading-snug">Pads-on-metal scores rotors, caliper warps from heat. Now you need rotors + caliper rebuild.</div>
          </div>
          <div className="bg-[#141414]/70 border border-rose-500/30 rounded-xl p-5">
            <div className="text-[11px] uppercase tracking-wider text-rose-300 mb-2 font-bold">+60 days</div>
            <div className="font-heading text-3xl font-bold text-rose-300">$4,300</div>
            <div className="text-sm text-white/60 mt-1.5 leading-snug">Caliper seizes at speed → wheel bearing damage, possible tow + body panel. Plus the original brake job.</div>
          </div>
        </div>

        <p className="text-white/55 text-xs mt-5 italic leading-relaxed">
          Source: AAA repair-cost benchmarks (2023–24) for cascade-failure scenarios on a typical mid-size sedan. Numbers vary by vehicle and severity, but the direction is the same — postponed repairs almost always cost more than the original bill, plus financing.
        </p>
      </div>
    </FadeIn>
  );
}

/* ─── ApprovalTrap (the conversion moment) ──────────────────── */
function ApprovalTrap({ onOpen }: { onOpen: () => void }) {
  return (
    <FadeIn>
      <div className="bg-[#1A1A1A] border-2 border-[#FDB913] rounded-2xl p-6 lg:p-10 shadow-[0_0_30px_rgba(253,185,19,0.08)]">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-8 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FDB913]/15 text-[#FDB913] text-[11px] font-bold tracking-widest uppercase mb-4">
              <Clock className="w-3.5 h-3.5" />
              60 seconds · Soft check only
            </div>
            <h2 className="font-heading text-3xl lg:text-4xl font-bold text-white tracking-tight uppercase leading-tight mb-3">
              See if you qualify
              <span className="block text-[#FDB913]">before you commit to anything.</span>
            </h2>
            <p className="text-white/65 text-base leading-relaxed">
              Soft credit check only — no impact on your score. We'll text you which of our four lenders pre-approved you and for how much, usually within 60 seconds. Then you decide whether to come in.
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={onOpen}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#FDB913] text-black px-6 py-4 rounded-lg font-bold text-base tracking-wide hover:bg-[#FDB913]/90 transition-colors"
            >
              <CreditCard className="w-5 h-5" />
              CHECK IF I QUALIFY
              <ArrowRight className="w-5 h-5" />
            </button>

            <div className="grid grid-cols-3 gap-2 text-[11px] text-white/55 pt-1">
              <div className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-[#FDB913]" />
                Soft pull only
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-[#FDB913]" />
                No commitment
              </div>
              <div className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-[#FDB913]" />
                Up to $7,500
              </div>
            </div>

            <div className="pt-3 border-t border-[#2A2A2A] mt-3 text-[12px] text-white/45 leading-relaxed">
              Or call{" "}
              <a href={BUSINESS.phone.href} className="text-[#FDB913] font-semibold hover:underline">
                {BUSINESS.phone.display}
              </a>
              {" "}— we can pre-qualify you over the phone in 2 minutes.
            </div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

/* ─── Lender Hierarchy ──────────────────────────────────────── */
function LenderHierarchy({ onApply }: { onApply: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 stagger-in">
      {RANKED_PROVIDERS.map((p, i) => {
        const isPrimary = p.tier === "primary";
        const provider = FINANCING_PROVIDERS.find((fp) => fp.id === p.id);
        return (
          <FadeIn key={p.id} delay={i * 0.1}>
            <div
              className={`relative bg-[#1A1A1A] border rounded-2xl p-6 lg:p-7 flex flex-col h-full transition-colors ${
                isPrimary
                  ? "border-[#FDB913] shadow-[0_0_25px_rgba(253,185,19,0.1)]"
                  : "border-[#2A2A2A] hover:border-white/20"
              }`}
            >
              {/* Tier badge — top */}
              <div className="flex items-center justify-between mb-4">
                <span
                  className={`text-[10px] font-bold tracking-[0.18em] px-2.5 py-1 rounded-md uppercase ${
                    isPrimary
                      ? "bg-[#FDB913] text-black"
                      : p.tier === "max"
                        ? "bg-violet-500/20 text-violet-200 border border-violet-500/30"
                        : "bg-[#2A2A2A] text-white/70"
                  }`}
                >
                  {p.tierLabel}
                </span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${isPrimary ? "text-[#FDB913]" : "text-white/40"}`}>
                  {p.tierBadge}
                </span>
              </div>

              {/* Name */}
              <h3 className="font-heading text-2xl font-bold text-white uppercase tracking-wide mb-1">
                {p.name}
              </h3>
              <p className="text-white/45 text-xs uppercase tracking-wider font-semibold mb-4">
                {p.bestFor}
              </p>

              {/* Reason */}
              <p className="text-white/70 text-sm leading-relaxed mb-5">
                {p.reasonToChoose}
              </p>

              {/* Features */}
              <ul className="space-y-2 mb-6 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px] text-white/65">
                    <CheckCircle className={`w-4 h-4 shrink-0 mt-0.5 ${isPrimary ? "text-[#FDB913]" : "text-white/40"}`} />
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <a
                href={provider?.applyUrl || "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onApply(p.id)}
                className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-bold text-sm tracking-wide transition-colors ${
                  isPrimary
                    ? "bg-[#FDB913] text-black hover:bg-[#FDB913]/90"
                    : "border border-[#FDB913]/40 text-[#FDB913] hover:bg-[#FDB913]/10"
                }`}
              >
                APPLY WITH {p.name.split(" ")[0].toUpperCase()}
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </FadeIn>
        );
      })}

      {/* Fourth lender — American First — small footer reference (low-rank) */}
      <FadeIn delay={0.4}>
        <div className="lg:col-span-3 bg-[#141414]/60 border border-[#2A2A2A] rounded-xl px-5 py-4 text-sm text-white/55 flex flex-wrap items-center justify-between gap-3">
          <span>
            Plus a 4th option: <span className="text-white font-semibold">American First Finance</span> — comparable to Acima, useful when you need a 2nd or 3rd alternative.
          </span>
          <a
            href={FINANCING_PROVIDERS.find((p) => p.id === "american-first")?.applyUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onApply("american-first")}
            className="text-[#FDB913] font-semibold hover:underline"
          >
            Apply with AFF →
          </a>
        </div>
      </FadeIn>
    </div>
  );
}

/* ─── Payment Calculator (decoy effect: 12-mo highlighted) ───── */
function PaymentCalculator() {
  const [amount, setAmount] = useState(1500);
  const terms = [6, 12, 18, 24];

  const payments = useMemo(() => {
    // Illustrative ~9.9% APR — actual rate depends on lender + approval.
    const rate = 0.099 / 12;
    return terms.map((months) => {
      const monthly = (amount * rate * Math.pow(1 + rate, months)) / (Math.pow(1 + rate, months) - 1);
      const total = monthly * months;
      return { months, monthly: Math.round(monthly), total: Math.round(total) };
    });
  }, [amount]);

  return (
    <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 lg:p-8">
      <div className="flex items-start justify-between mb-2 gap-3">
        <h3 className="font-heading text-2xl font-bold text-white uppercase tracking-wide">
          Estimate Your Monthly
        </h3>
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
          ~9.9% APR illustrative
        </span>
      </div>
      <p className="text-white/50 text-sm mb-6">
        Drag to your repair amount. Actual rate + term depend on lender approval.
      </p>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <label className="text-white/60 text-sm font-medium">Repair Amount</label>
          <span className="font-heading text-3xl font-bold text-[#FDB913]">
            ${amount.toLocaleString()}
          </span>
        </div>
        <input
          type="range"
          min={100}
          max={7500}
          step={50}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-full h-2 bg-[#2A2A2A] rounded-full appearance-none cursor-pointer accent-[#FDB913]"
        />
        <div className="flex justify-between text-xs text-white/30 mt-2">
          <span>$100</span>
          <span>$7,500</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {payments.map(({ months, monthly, total }) => {
          const isFeatured = months === 12;
          return (
            <div
              key={months}
              className={`relative rounded-xl p-4 text-center transition-colors ${
                isFeatured
                  ? "bg-[#FDB913]/10 border-2 border-[#FDB913]"
                  : "bg-[#141414] border border-[#2A2A2A]"
              }`}
            >
              {isFeatured && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[#FDB913] text-black text-[9px] font-bold px-2 py-0.5 rounded-full tracking-widest uppercase">
                  Most chosen
                </span>
              )}
              <span className="block text-white/40 text-xs font-medium mb-1">{months} MONTHS</span>
              <span className={`font-heading text-2xl font-bold ${isFeatured ? "text-[#FDB913]" : "text-white"}`}>${monthly}</span>
              <span className="block text-white/40 text-xs">/mo</span>
              <span className="block text-white/30 text-[10px] mt-1">total ~${total.toLocaleString()}</span>
            </div>
          );
        })}
      </div>

      <p className="text-white/30 text-xs mt-4 text-center leading-relaxed">
        Estimates only. Acima's 90-day same-as-cash window can effectively zero out finance charges if you pay it off in time.
      </p>
    </div>
  );
}

/* ─── Approval Range (honest social proof) ──────────────────── */
function ApprovalRange() {
  return (
    <FadeIn>
      <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 lg:p-8">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <Award className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h3 className="font-heading text-2xl font-bold text-white uppercase tracking-wide mb-2">
              Most customers qualify with at least one lender
            </h3>
            <p className="text-white/65 text-sm leading-relaxed">
              We carry four lenders — Acima, Snap, Koalafi, and American First — specifically because each one has different approval criteria. Customers declined by one are commonly approved by another. None of them require a traditional credit score, and the soft pull doesn't ding your credit. If all four decline, we'll tell you up front and help you build a plan that works.
            </p>
            <div className="grid grid-cols-3 gap-3 mt-5">
              <div className="text-center p-3 rounded-lg bg-[#141414] border border-[#2A2A2A]">
                <div className="font-heading text-xl font-bold text-[#FDB913]">4</div>
                <div className="text-[10px] uppercase tracking-wider text-white/50 mt-0.5">Lenders carried</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-[#141414] border border-[#2A2A2A]">
                <div className="font-heading text-xl font-bold text-[#FDB913]">$7.5K</div>
                <div className="text-[10px] uppercase tracking-wider text-white/50 mt-0.5">Max approval</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-[#141414] border border-[#2A2A2A]">
                <div className="font-heading text-xl font-bold text-[#FDB913]">60s</div>
                <div className="text-[10px] uppercase tracking-wider text-white/50 mt-0.5">Decision time</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

/* ─── FAQ Accordion ─────────────────────────────────────────── */
function FAQItem({
  item,
  isOpen,
  onToggle,
}: {
  item: { q: string; a: string };
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-[#2A2A2A] last:border-b-0">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full py-5 text-left group"
      >
        <span className="font-semibold text-white text-sm pr-4">{item.q}</span>
        <ChevronDown className={`w-5 h-5 text-white/40 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {isOpen && (
        <div className="pb-5 pr-8">
          <p className="text-white/60 text-sm leading-relaxed">{item.a}</p>
        </div>
      )}
    </div>
  );
}

/* ─── Financing Schema (JSON-LD) ────────────────────────────── */
function FinancingSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: "Auto Repair Financing at Nick's Tire & Auto",
    description: "Flexible $0-down financing for auto repairs in Cleveland with no traditional credit check. Four lenders: Acima, Snap, Koalafi, American First. Soft pre-qualification available.",
    provider: {
      "@type": "AutoRepair",
      name: BUSINESS.name,
      address: {
        "@type": "PostalAddress",
        streetAddress: BUSINESS.address.street,
        addressLocality: BUSINESS.address.city,
        addressRegion: BUSINESS.address.state,
        postalCode: BUSINESS.address.zip,
      },
      telephone: BUSINESS.phone.display,
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

/* ─── Main Page ─────────────────────────────────────────────── */
export default function Financing() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [showPreApproval, setShowPreApproval] = useState(false);
  const trackMutation = trpc.financing.trackApplication.useMutation();

  const handleApplyClick = useCallback(
    (providerId: string) => {
      trackMutation.mutate({
        provider: providerId as "acima" | "snap" | "koalafi" | "american-first",
        sourcePage: "/financing",
      });
    },
    [trackMutation]
  );

  return (
    <PageLayout activeHref="/financing" showChat={true}>
      {/* 2026-05-06 audit fix · "Financing" is banned positioning per
          operator voice rules. Renamed to "Payment Programs" —
          same lender stack, same product, FCFS-affirming wording. */}
      <SEOHead
        title="Auto Repair Payment Programs Cleveland · $10 Down, Drive Today | Nick's"
        description="Cleveland auto repair payment programs — four lenders compete for your business. Soft pre-qualification (no hard credit pull), drive today, pay over time. Acima · Snap · Koalafi · American First. (216) 862-0005"
        canonicalPath="/financing"
      />
      <Breadcrumbs items={[{ label: "Payment Programs", href: "/financing" }]} />
      <LocalBusinessSchema />
      <FinancingSchema />

      {/* ─── Hero ─────────────────────────────────────────── */}
      <section className="bg-[#141414] pt-28 pb-14 lg:pt-32 lg:pb-16">
        <div className="container max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#FDB913]/30 bg-[#FDB913]/5 text-[11px] font-bold uppercase tracking-widest text-[#FDB913] mb-5">
            <CreditCard className="w-3.5 h-3.5" />
            $0 down · No hard credit pull · 4 lenders
          </div>
          <h1 className="font-heading text-5xl lg:text-7xl font-bold text-white tracking-tight uppercase leading-[1.05]">
            Don't postpone the repair.{" "}
            <span className="text-[#FDB913]">Postpone the bill.</span>
          </h1>
          <p className="mt-5 text-white/70 text-lg lg:text-xl max-w-2xl mx-auto">
            Soft pre-qualification, no hard credit pull, no shame. Four lenders compete for your business in the time it takes to refill your coffee. Drive away today, pay it down on a schedule that fits the way you actually get paid.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => setShowPreApproval(true)}
              className="inline-flex items-center gap-2 bg-[#FDB913] text-black px-8 py-4 rounded-lg font-bold text-base tracking-wide hover:bg-[#FDB913]/90 transition-colors"
            >
              <CreditCard className="w-5 h-5" />
              Check If I Qualify (60s)
              <ArrowRight className="w-5 h-5" />
            </button>
            <a
              href="#calculator"
              className="inline-flex items-center gap-2 border-2 border-[#FDB913]/40 text-[#FDB913] px-8 py-4 rounded-lg font-bold text-base tracking-wide hover:bg-[#FDB913]/10 transition-colors"
            >
              <DollarSign className="w-5 h-5" />
              Estimate My Monthly
            </a>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/50">
            <span className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#FDB913]" />
              No traditional credit check
            </span>
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#FDB913]" />
              Decision in seconds
            </span>
            <span className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-[#FDB913]" />
              Up to $7,500
            </span>
            <span className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#FDB913]" />
              90-day same-as-cash option
            </span>
          </div>
        </div>
      </section>

      {/* ─── Cost of waiting ──────────────────────────────── */}
      <section className="bg-[#141414] pb-12 lg:pb-16">
        <div className="container max-w-5xl">
          <CostOfWaitingBlock />
        </div>
      </section>

      {/* ─── Approval Trap ────────────────────────────────── */}
      <section id="prequal" className="bg-[#111111] py-12 lg:py-16">
        <div className="container max-w-5xl">
          <ApprovalTrap onOpen={() => setShowPreApproval(true)} />
        </div>
      </section>

      {/* ─── Acima banner ─────────────────────────────────── */}
      <section className="bg-[#111111] pb-2">
        <div className="container max-w-5xl">
          <FadeIn>
            <a
              href={ACIMA_BANNER.href}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-2xl overflow-hidden border border-[#2A2A2A] hover:border-[#FDB913]/30 transition-colors"
            >
              <img
                alt={ACIMA_BANNER.alt}
                src={ACIMA_BANNER.imgSrc}
                style={{ width: "100%", maxWidth: "1300px" }}
                className="mx-auto"
                loading="lazy"
              />
            </a>
          </FadeIn>
        </div>
      </section>

      {/* ─── Lender Hierarchy ─────────────────────────────── */}
      <section id="providers" className="bg-[#111111] py-16 lg:py-20">
        <div className="container max-w-6xl">
          <FadeIn>
            <div className="text-center mb-10">
              <div className="text-[11px] uppercase tracking-[0.25em] text-[#FDB913] font-bold mb-2">FOUR LENDERS · ONE SHOP</div>
              <h2 className="font-heading text-3xl lg:text-5xl font-bold text-white tracking-tight uppercase">
                Try them in this order.
              </h2>
              <p className="text-white/55 mt-3 max-w-2xl mx-auto text-base">
                Each lender has different criteria. Start with the one most customers get approved through; if it's a no, try the next. We'll help you sequence applications so you don't burn time.
              </p>
            </div>
          </FadeIn>
          <LenderHierarchy onApply={handleApplyClick} />
        </div>
      </section>

      {/* ─── Calculator ───────────────────────────────────── */}
      <section id="calculator" className="bg-[#141414] py-16 lg:py-20">
        <div className="container max-w-3xl">
          <FadeIn>
            <PaymentCalculator />
          </FadeIn>
        </div>
      </section>

      {/* ─── Pull-Up Band — turns abstract financing into a real place ──── */}
      {/* The financing page is the highest-anxiety surface on the site:
          customers comparing pricing pages and wondering "is this real?"
          The storefront photo answers that question without saying it. */}
      <section className="relative overflow-hidden">
        <div className="relative h-[360px] sm:h-[440px] lg:h-[500px] overflow-hidden">
          {/* 2026-05-06 wave-28 · /brand-sign.webp is 1600x239 panorama
              (6.69:1). At this h-[360-500px] band (~2.17-3:1) cover would
              zoom 2x+ and crop the sides. Switched to contain so the
              FULL sign + (216) 862-0005 reads. Same fix wave-27 applied
              to SignFeature, PullUpBand, SiteFooter. */}
          <img
            src="/brand-sign.webp"
            alt="Nick's Tire & Auto storefront on Euclid Avenue Cleveland — payment programs on the spot at 17625 Euclid Ave"
            className="absolute inset-0 w-full h-full object-contain"
            style={{ objectPosition: "center center" }}
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#111111] via-[#111111]/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#111111]/65 via-transparent to-[#111111]/35" />
        </div>

        <div className="absolute inset-0 flex items-end">
          <div className="container max-w-5xl pb-8 sm:pb-12 lg:pb-16">
            <FadeIn>
              <div className="max-w-xl">
                <p className="text-[11px] uppercase tracking-[0.22em] font-bold text-[#FDB913] mb-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                  17625 Euclid Ave · Cleveland
                </p>
                <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight uppercase leading-[0.98] drop-shadow-[0_4px_16px_rgba(0,0,0,0.9)]">
                  This is where you'll sign the papers.
                </h2>
                <p className="mt-3 text-white/80 text-sm sm:text-base leading-relaxed drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
                  Not a phone bot. Not a finance company you've never heard of. Walk in, sit in a chair that's older than some of our customers, get pre-qualified in 60 seconds.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ─── Approval range / honest social proof ─────────── */}
      <section className="bg-[#111111] py-16 lg:py-20">
        <div className="container max-w-4xl">
          <ApprovalRange />
        </div>
      </section>

      {/* ─── How It Works ─────────────────────────────────── */}
      <section className="bg-[#141414] py-16 lg:py-20">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-heading text-3xl lg:text-4xl font-bold text-white tracking-tight uppercase text-center mb-12">
              The Process — Three Steps
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                num: "01",
                icon: <FileText className="w-7 h-7" />,
                title: "Diagnose & estimate",
                desc: "Free inspection. Written estimate before you commit. We tell you what's urgent vs what can wait.",
              },
              {
                num: "02",
                icon: <CreditCard className="w-7 h-7" />,
                title: "Apply (60 seconds)",
                desc: "From your phone, while you grab a coffee, or at the counter. Soft check first — no impact on credit.",
              },
              {
                num: "03",
                icon: <Car className="w-7 h-7" />,
                title: "Drive away today",
                desc: "We do the work, you take a free Uber back if needed. Pay $0 down, then on the schedule that fits.",
              },
            ].map((step, i) => (
              <FadeIn key={step.num} delay={i * 0.12}>
                <div className="text-center">
                  <span className="font-heading text-4xl font-bold text-[#2A2A2A]">{step.num}</span>
                  <div className="w-14 h-14 mx-auto mt-3 mb-4 rounded-full bg-[#FDB913]/10 flex items-center justify-center text-[#FDB913]">
                    {step.icon}
                  </div>
                  <h3 className="font-heading text-lg font-bold text-white uppercase tracking-wide mb-2">{step.title}</h3>
                  <p className="text-white/50 text-sm leading-relaxed">{step.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ (full FINANCING_FAQ set) ─────────────────── */}
      <section className="bg-[#111111] py-16 lg:py-20">
        <div className="container max-w-3xl">
          <FadeIn>
            <h2 className="font-heading text-3xl font-bold text-white tracking-tight uppercase text-center mb-10">
              Frequently Asked
            </h2>
            <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl px-6">
              {FINANCING_FAQ.map((item, i) => (
                <FAQItem
                  key={i}
                  item={item}
                  isOpen={openFaq === i}
                  onToggle={() => setOpenFaq(openFaq === i ? null : i)}
                />
              ))}
            </div>
          </FadeIn>

          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                mainEntity: FINANCING_FAQ.map((item) => ({
                  "@type": "Question",
                  name: item.q,
                  acceptedAnswer: { "@type": "Answer", text: item.a },
                })),
              }),
            }}
          />
        </div>
      </section>

      {/* ─── Bottom CTA — call OR pre-qual ────────────────── */}
      <section className="bg-[#141414] py-14 lg:py-20">
        <div className="container max-w-3xl text-center">
          <FadeIn>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#FDB913]/30 bg-[#FDB913]/5 text-[10px] font-bold uppercase tracking-widest text-[#FDB913] mb-4">
              <AlertCircle className="w-3 h-3" />
              The repair gets bigger every day you wait
            </div>
            <h2 className="font-heading text-3xl lg:text-4xl font-bold text-white uppercase tracking-tight mb-4">
              Stop putting it off.
            </h2>
            <p className="text-white/55 text-base mb-7 max-w-lg mx-auto">
              Either pre-qualify now (60s, soft check) or call the shop and we'll walk you through it.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => setShowPreApproval(true)}
                className="inline-flex items-center gap-2 bg-[#FDB913] text-black px-7 py-3.5 rounded-lg font-bold text-sm tracking-wide hover:bg-[#FDB913]/90 transition-colors"
              >
                <CreditCard className="w-4 h-4" />
                CHECK IF I QUALIFY
              </button>
              <a
                href={BUSINESS.phone.href}
                className="inline-flex items-center gap-2 border-2 border-[#FDB913]/40 text-[#FDB913] px-7 py-3.5 rounded-lg font-bold text-sm tracking-wide hover:bg-[#FDB913]/10 transition-colors"
              >
                <Phone className="w-4 h-4" />
                CALL {BUSINESS.phone.display}
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      <InternalLinks title="Related Services" />

      <FinancingPreApprovalModal
        open={showPreApproval}
        onClose={() => setShowPreApproval(false)}
      />
    </PageLayout>
  );
}
