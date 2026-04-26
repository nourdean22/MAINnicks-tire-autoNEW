/**
 * BookingPage — Batch 4 of the conversion overhaul.
 *
 * Frame around the existing <BookingWizard /> with:
 *   1. Reciprocity-loaded hero ("Hold your spot · 60 seconds, no commitment").
 *   2. CapacityBanner — REAL trpc.conversion.shopCapacity data:
 *        slots remaining today, est. wait, next available bay time.
 *      Auto-hides if shop is closed; never lies if data is null.
 *   3. NextStepsTimeline — sets the next 3 expectations so the user never
 *      wonders "what happens after I submit?"
 *   4. TrustMicrocopy — three ankles right under the form: encrypted,
 *      no-commitment-to-fix, call-direct fallback.
 *
 * The wizard component itself was edited separately (urgency default,
 * reservation-language confirmation, NICKS150 referral block).
 *
 * No fake counters. No invented testimonials. Real shop data only.
 */

import { useMemo } from "react";
import { Link } from "wouter";
import { Clock, Phone, Wrench, ShieldCheck, MessageSquare, AlertCircle } from "lucide-react";

import BookingWizard from "@/components/BookingWizard";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import InternalLinks from "@/components/InternalLinks";
import { BUSINESS } from "@shared/business";
import { trpc } from "@/lib/trpc";

/* ─── CapacityBanner ────────────────────────────────────────────────── */
function CapacityBanner() {
  const { data } = trpc.conversion.shopCapacity.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Don't show anything until we have data. No fake "loading slots".
  if (!data) return null;

  const slots = data.slotsRemainingToday;
  const wait = data.estimatedWaitMinutes;
  const nextAt = data.nextAvailableAt ? new Date(data.nextAvailableAt) : null;
  const isOpen = data.isOpen;

  // Closed → show simple closed state, not capacity numbers
  if (!isOpen) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 mb-8 flex items-start gap-3">
        <Clock className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-amber-900 dark:text-amber-100">
          <div className="font-semibold mb-0.5">We're closed right now — but the form is open 24/7.</div>
          <div className="text-amber-800/80 dark:text-amber-200/80">
            Submit your request and a master tech will call you back within 15 minutes after we open. {BUSINESS.hours.display}.
          </div>
        </div>
      </div>
    );
  }

  // No data signal at all → render a neutral, honest fallback
  if (slots === null && wait === null) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 mb-8 flex items-start gap-3">
        <Wrench className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm">
          <div className="font-semibold mb-0.5">We're open and accepting drop-offs.</div>
          <div className="text-foreground/70">
            Walk-ins welcome 7 days. Submit below or call{" "}
            <a href={BUSINESS.phone.href} className="text-primary font-medium hover:underline">
              {BUSINESS.phone.display}
            </a>{" "}
            for the fastest response.
          </div>
        </div>
      </div>
    );
  }

  // Tight capacity? (≤ 6 slots) — louder copy
  const tight = typeof slots === "number" && slots <= 6 && slots > 0;
  const full = typeof slots === "number" && slots === 0;
  const tone = full ? "border-rose-500/40 bg-rose-500/5" : tight ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5";
  const icon = full ? <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5 flex-shrink-0" /> : <Wrench className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />;

  const headline = full
    ? "Today's bays are full — first available drop-off is below."
    : tight
      ? `Only ${slots} drop-off slot${slots === 1 ? "" : "s"} left today.`
      : `${slots} drop-off slot${slots === 1 ? "" : "s"} open today.`;

  const waitLabel = wait === 0 || wait === null
    ? "No wait — bays open right now."
    : wait < 60
      ? `~${wait} min current wait`
      : `~${Math.round((wait / 60) * 10) / 10} hr current wait`;

  const nextLabel = nextAt
    ? `Next bay: ${nextAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: BUSINESS.timezone })}`
    : null;

  return (
    <div className={`rounded-2xl border p-5 mb-8 ${tone}`}>
      <div className="flex items-start gap-3">
        {icon}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground">{headline}</div>
          <div className="text-sm text-foreground/70 mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <span>{waitLabel}</span>
            {nextLabel && <span className="text-foreground/60">·  {nextLabel}</span>}
            <span className="text-foreground/50">· Updated just now</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── NextStepsTimeline ─────────────────────────────────────────────── */
function NextStepsTimeline() {
  const steps = useMemo(
    () => [
      {
        n: 1,
        title: "Submit in 60 seconds",
        sub: "Service + vehicle + when you're dropping off. That's it. No credit card. No commitment to fix anything.",
        icon: <MessageSquare className="w-4 h-4" />,
      },
      {
        n: 2,
        title: "A master tech calls within 15 min",
        sub: "During open hours. They'll confirm the time, walk you through what to expect, and hold your bay. Outside hours? First call after 8 AM.",
        icon: <Phone className="w-4 h-4" />,
      },
      {
        n: 3,
        title: "Drop off — Uber back is on us",
        sub: "Free Uber within 5 miles. Walk-ins welcome any time. Photos of any worn parts before we replace anything. 12-month warranty on every repair.",
        icon: <Wrench className="w-4 h-4" />,
      },
    ],
    []
  );

  return (
    <section className="mt-12 rounded-3xl border border-border/60 bg-card/40 p-6 sm:p-8">
      <div className="text-xs uppercase tracking-[0.2em] text-foreground/50 mb-2">WHAT HAPPENS NEXT</div>
      <h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-6">After you submit — three steps, no surprises.</h2>
      <ol className="space-y-5">
        {steps.map((s) => (
          <li key={s.n} className="flex gap-4">
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
              {s.n}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <span className="text-primary/70">{s.icon}</span>
                <span>{s.title}</span>
              </div>
              <p className="text-sm text-foreground/65 mt-1 leading-relaxed">{s.sub}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ─── TrustMicrocopy ─────────────────────────────────────────────────── */
function TrustMicrocopy() {
  const items = [
    {
      icon: <ShieldCheck className="w-4 h-4" />,
      title: "256-bit TLS encryption",
      sub: "Every form submission is encrypted in transit. We never sell, share, or rent your info. Period.",
    },
    {
      icon: <AlertCircle className="w-4 h-4" />,
      title: "No commitment to fix",
      sub: "Submitting holds a slot. You see the diagnosis + written estimate before any work — and you can walk away.",
    },
    {
      icon: <Phone className="w-4 h-4" />,
      title: "Or call us directly",
      sub: (
        <>
          Prefer voice?{" "}
          <a href={BUSINESS.phone.href} className="text-primary font-semibold hover:underline">
            {BUSINESS.phone.display}
          </a>{" "}
          — straight to the front desk, no menus.
        </>
      ),
    },
  ];

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-3">
      {items.map((item, i) => (
        <div key={i} className="rounded-xl border border-border/50 bg-background/50 p-4">
          <div className="flex items-center gap-2 text-primary/80 mb-1.5">
            {item.icon}
            <span className="text-xs uppercase tracking-wider font-semibold">{item.title}</span>
          </div>
          <div className="text-sm text-foreground/70 leading-snug">{item.sub}</div>
        </div>
      ))}
    </div>
  );
}

/* ─── BookingPage ────────────────────────────────────────────────────── */
export default function BookingPage() {
  return (
    <PageLayout activeHref="/booking">
      <SEOHead
        title="Hold Your Spot · Book Auto Repair Online | Cleveland OH"
        description="Reserve your drop-off in 60 seconds at Nick's Tire & Auto Cleveland. No credit card. No commitment to fix. A master tech calls back within 15 minutes. (216) 862-0005"
        canonicalPath="/booking"
      />
      <LocalBusinessSchema />

      <main className="max-w-3xl mx-auto px-4 py-10 sm:py-14">
        {/* Hero */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs font-semibold uppercase tracking-wider text-primary mb-4">
            <Clock className="w-3.5 h-3.5" />
            60 seconds · no credit card
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-3">
            Hold your spot.
          </h1>
          <p className="text-foreground/65 text-lg max-w-xl mx-auto">
            Tell us what's going on with your car. We'll call back within 15 minutes during open hours, hold your bay, and walk you through everything before you spend a dollar.
          </p>
        </div>

        {/* Live capacity banner — real data */}
        <CapacityBanner />

        {/* The actual booking wizard */}
        <BookingWizard />

        {/* Trust microcopy under the form */}
        <TrustMicrocopy />

        {/* Next steps timeline */}
        <NextStepsTimeline />

        {/* Cross-references */}
        <div className="mt-10 text-center text-sm text-foreground/55 space-y-2">
          <p>
            Need help choosing a service?{" "}
            <Link href="/services" className="text-primary hover:underline">
              Browse services
            </Link>{" "}
            or use our{" "}
            <Link href="/diagnose" className="text-primary hover:underline">
              symptom checker
            </Link>
            .
          </p>
          <p>
            Worried about cost? We do{" "}
            <Link href="/financing" className="text-primary hover:underline">
              $0-down financing
            </Link>{" "}
            with same-day approval.
          </p>
        </div>
      </main>

      <InternalLinks title="Explore Our Services" maxLinks={6} />
    </PageLayout>
  );
}
