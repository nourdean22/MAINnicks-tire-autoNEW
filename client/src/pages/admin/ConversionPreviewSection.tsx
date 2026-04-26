/**
 * Conversion Preview — admin sandbox where every conversion-architecture
 * component renders side-by-side with sample data so Nour can verify them
 * before they go on public pages.
 *
 * Also shows a live feed of conversion events firing across the public
 * site (admin-only via tRPC `conversion.recentEvents`).
 *
 * Per the conversion-overhaul spec (`docs/CONVERSION-OVERHAUL-V1.1.md`):
 *   "Each batch ships with raw event logging at minimum so we can backfill
 *    the dashboard later."
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "./shared";
import LiveVisitorCounter from "@/components/conversion/LiveVisitorCounter";
import UrgencyWidget from "@/components/conversion/UrgencyWidget";
import ExitIntentModal from "@/components/conversion/ExitIntentModal";
import DecoyPricingTable from "@/components/conversion/DecoyPricingTable";
import LossAversionStat from "@/components/conversion/LossAversionStat";
import FearCalibrationBlock from "@/components/conversion/FearCalibrationBlock";
import AnchorAdjustmentTable from "@/components/conversion/AnchorAdjustmentTable";
import ServiceTriageCard from "@/components/conversion/ServiceTriageCard";
import { useWeatherCTA } from "@/hooks/useWeatherCTA";
import { useConversionTracking } from "@/hooks/useConversionTracking";
import { Wrench, Clock, AlertTriangle, Disc, Activity, Zap, Sparkles } from "lucide-react";

export default function ConversionPreviewSection() {
  const [showExitModal, setShowExitModal] = useState(false);
  const weatherCTA = useWeatherCTA();
  const track = useConversionTracking();
  const { data: events } = trpc.conversion.recentEvents.useQuery(
    { limit: 30 },
    { refetchInterval: 10_000, staleTime: 8_000 }
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Conversion Preview"
        subtitle="Sandbox for the conversion-architecture components. Every block here is the SAME component the public site renders — change it once, it lands everywhere."
      />

      {/* ─── LIVE EVENTS FEED ─── */}
      <section>
        <h2 className="text-xs font-bold tracking-widest text-foreground/50 uppercase mb-3">Live conversion events</h2>
        <div className="rounded-lg border border-border/30 bg-card/60 p-4">
          {events?.byType && Object.keys(events.byType).length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.entries(events.byType)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.04] border border-border/30 px-2.5 py-1 text-[10px] font-mono"
                  >
                    <span className="text-foreground/50">{type}</span>
                    <span className="font-bold text-primary">{count}</span>
                  </span>
                ))}
            </div>
          ) : (
            <p className="text-[12px] text-foreground/40 italic">No events yet — interact with components below to populate.</p>
          )}
          <div className="max-h-48 overflow-y-auto space-y-1 mt-2">
            {events?.events?.map((ev, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[11px] font-mono text-foreground/60">
                <span className="text-foreground/30">{ev.ts ? new Date(ev.ts).toLocaleTimeString() : "?"}</span>
                <span className="text-primary">{ev.type}</span>
                {ev.element && <span className="text-foreground/50">[{ev.element}]</span>}
                {ev.page && <span className="text-foreground/40">{ev.page}</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── LIVE VISITOR COUNTER ─── */}
      <section>
        <h2 className="text-xs font-bold tracking-widest text-foreground/50 uppercase mb-3">LiveVisitorCounter</h2>
        <div className="rounded-lg border border-border/30 bg-card/60 p-6">
          <LiveVisitorCounter minToShow={1} />
          <p className="mt-3 text-[11px] text-foreground/40 italic">
            Auto-hides when fewer than `minToShow` (default 3) sessions are active. Pulls real session data from `trpc.conversion.liveSessions`.
          </p>
        </div>
      </section>

      {/* ─── WEATHER CTA ─── */}
      <section>
        <h2 className="text-xs font-bold tracking-widest text-foreground/50 uppercase mb-3">useWeatherCTA hook</h2>
        <div className="rounded-lg border border-border/30 bg-card/60 p-6">
          {weatherCTA ? (
            <div
              className={`rounded p-4 ${
                weatherCTA.urgency === "high"
                  ? "bg-red-500/10 border border-red-500/30"
                  : weatherCTA.urgency === "medium"
                    ? "bg-amber-500/10 border border-amber-500/30"
                    : "bg-foreground/[0.04] border border-border/30"
              }`}
            >
              <div className="font-bold text-base text-foreground mb-1">{weatherCTA.message}</div>
              <div className="text-sm text-foreground/70 mb-3">{weatherCTA.sub}</div>
              <button
                onClick={() => track({ type: "weather_cta_clicked", element: weatherCTA.ctaHref, props: { urgency: weatherCTA.urgency } })}
                className="rounded bg-primary text-primary-foreground px-4 py-2 text-xs font-bold tracking-wide hover:bg-primary/90"
              >
                {weatherCTA.ctaLabel}
              </button>
            </div>
          ) : (
            <p className="text-[12px] text-foreground/40 italic">No weather-driven CTA active. Hook returns null on calm/normal days — by design.</p>
          )}
        </div>
      </section>

      {/* ─── SERVICE TRIAGE CARDS ─── */}
      <section>
        <h2 className="text-xs font-bold tracking-widest text-foreground/50 uppercase mb-3">ServiceTriageCard grid</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ServiceTriageCard
            tone="danger"
            icon={<Disc className="w-5 h-5" />}
            symptom="GRINDING OR SQUEALING?"
            consequence="You're destroying rotors at $3.50 per stop."
            relief="Same-day fix from $149/axle."
            ctaLabel="STOP THE DAMAGE"
            ctaHref="/brakes"
          />
          <ServiceTriageCard
            tone="warning"
            icon={<Activity className="w-5 h-5" />}
            symptom="CHECK ENGINE LIGHT?"
            consequence="$200 sensor → $4,000 cat converter if ignored."
            relief="Free 5-min code scan, $95 full diagnostic."
            ctaLabel="DIAGNOSE NOW"
            ctaHref="/diagnostics"
          />
          <ServiceTriageCard
            tone="info"
            icon={<Wrench className="w-5 h-5" />}
            symptom="TIRES BALD OR LOW?"
            consequence="Stopping distance doubles in rain."
            relief="Used tires from $60, new from $89, installed in 20 min."
            ctaLabel="GET TIRES TODAY"
            ctaHref="/tires"
          />
        </div>
      </section>

      {/* ─── ANCHOR / ADJUSTMENT TABLE ─── */}
      <section>
        <h2 className="text-xs font-bold tracking-widest text-foreground/50 uppercase mb-3">AnchorAdjustmentTable</h2>
        <div className="rounded-lg border border-border/30 bg-card/60 p-6">
          <AnchorAdjustmentTable
            serviceName="Brake repair, per axle"
            rows={[
              { label: "Cleveland-area dealer (avg quote)", price: "$800", strikethrough: true },
              { label: "National chain shop", price: "$600", strikethrough: true },
              { label: "Nick's", price: "$329", ours: true },
            ]}
            source="Source: representative quotes, Cleveland metro 2026."
          />
        </div>
      </section>

      {/* ─── DECOY PRICING TABLE ─── */}
      <section>
        <h2 className="text-xs font-bold tracking-widest text-foreground/50 uppercase mb-3">DecoyPricingTable</h2>
        <div className="rounded-lg border border-border/30 bg-card/60 p-6">
          <DecoyPricingTable
            serviceName="Brake Repair"
            anchors={[
              { label: "Dealer", price: "$800", strikethrough: true },
              { label: "Chain shop", price: "$600", strikethrough: true },
            ]}
            tiers={[
              {
                name: "Pad Replacement",
                price: "$149",
                sub: "per axle, most vehicles",
                use: "Pads worn but rotors still within spec.",
                includes: ["Quality pads", "Caliper lube", "Brake fluid top-off", "12-mo / 12K warranty"],
                ctaLabel: "BOOK PADS",
              },
              {
                name: "Pads + Rotors",
                price: "$329",
                sub: "per axle, most vehicles",
                use: "Rotors scored or below minimum thickness.",
                featured: true,
                includes: ["New pads + rotors", "Full system test drive", "Caliper lube + fluid top-off", "12-mo / 12K warranty"],
                ctaLabel: "BOOK MOST POPULAR",
              },
              {
                name: "Full Brake Job",
                price: "$449+",
                sub: "per axle, includes calipers if needed",
                use: "Calipers seized, lines leaking, full refresh.",
                includes: ["New pads + rotors + calipers", "Full hydraulic flush", "Lines + hoses inspected", "12-mo / 12K warranty"],
                ctaLabel: "BOOK FULL JOB",
              },
            ]}
            footnote="All prices include installation. We show you the worn part before we replace anything."
          />
        </div>
      </section>

      {/* ─── LOSS AVERSION STAT ─── */}
      <section>
        <h2 className="text-xs font-bold tracking-widest text-foreground/50 uppercase mb-3">LossAversionStat</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LossAversionStat
            amount={8.5}
            unit="per day"
            label="lost in preventable damage"
            reason="Worn brake pads eat rotors faster every mile. The longer you wait, the bigger the bill."
            ctaHref="/brakes"
            ctaLabel="STOP THE DAMAGE"
          />
          <LossAversionStat
            amount={47}
            unit="per day"
            label="of compounding engine damage"
            reason="Check engine light ignored for 30 days = $1,400 in additional repairs on average."
            ctaHref="/diagnostics"
            ctaLabel="DIAGNOSE NOW"
          />
        </div>
      </section>

      {/* ─── FEAR CALIBRATION BLOCK ─── */}
      <section>
        <h2 className="text-xs font-bold tracking-widest text-foreground/50 uppercase mb-3">FearCalibrationBlock</h2>
        <div className="rounded-lg border border-border/30 bg-card/60 p-6">
          <FearCalibrationBlock
            heading="What failing brakes actually mean"
            stats={[
              {
                value: "287",
                unit: "feet",
                consequence: "added stopping distance at 60 mph with worn pads — that's two football fields into an intersection.",
                source: "NHTSA stopping-distance benchmarks.",
              },
              {
                value: "400°F",
                consequence: "the boiling point of fresh brake fluid. Old fluid drops to 280°F. Highway speed + a hill = zero brakes.",
              },
              {
                value: "4",
                unit: "systems",
                consequence: "Modern cars have 4 independent brake systems. Multi-system failure kills. We test all 4.",
              },
            ]}
          />
        </div>
      </section>

      {/* ─── EXIT INTENT MODAL TRIGGER ─── */}
      <section>
        <h2 className="text-xs font-bold tracking-widest text-foreground/50 uppercase mb-3">ExitIntentModal</h2>
        <div className="rounded-lg border border-border/30 bg-card/60 p-6">
          <p className="text-[12px] text-foreground/60 mb-3">
            On public pages, this modal triggers automatically when the user moves their mouse to the top edge of the viewport (with an 8s arming delay so quick bounces don't fire it). Click below to preview.
          </p>
          <button
            onClick={() => {
              localStorage.removeItem("exit-intent-shown-until");
              setShowExitModal(true);
              setTimeout(() => {
                // simulate the trigger
                document.dispatchEvent(new MouseEvent("mouseleave", { clientY: -10 }));
              }, 100);
            }}
            className="rounded bg-foreground/10 hover:bg-foreground/20 px-4 py-2 text-xs font-semibold transition-colors"
          >
            Preview Exit Intent Modal
          </button>
          {showExitModal && <ExitIntentModal />}
        </div>
      </section>

      {/* ─── URGENCY WIDGET ─── */}
      <section>
        <h2 className="text-xs font-bold tracking-widest text-foreground/50 uppercase mb-3">UrgencyWidget</h2>
        <div className="rounded-lg border border-border/30 bg-card/60 p-6">
          <p className="text-[12px] text-foreground/60 mb-2">
            Sticky bottom-right widget. Triggers when scrolled past 35% of the page on public pages. Hidden on /admin (this very page included). Scroll any public page to test.
          </p>
          <a
            href="/"
            target="_blank"
            rel="noopener"
            className="inline-flex rounded bg-primary text-primary-foreground px-4 py-2 text-xs font-bold tracking-wide hover:bg-primary/90"
          >
            Open homepage in new tab to see it →
          </a>
        </div>
      </section>

      <UrgencyWidget />
    </div>
  );
}
