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
import { Wrench, Disc, Activity, TrendingUp, Users } from "lucide-react";

// ─── Source labels — keep in sync with leadRouter source enum ──────
const SOURCE_LABELS: Record<string, string> = {
  popup: "Popup form",
  chat: "Chat widget",
  booking: "Booking page",
  manual: "Manual entry",
  callback: "Callback request",
  fleet: "Fleet inquiry",
  financing_preapproval: "Financing pre-qual",
  careers: "Careers page",
  sms_capture: "Text-me-quote",
  newsletter: "Newsletter signup",
};

/**
 * ConversionDashboard — the Batch 9 component. Renders at the top of the
 * Conversion tab in admin. Real metrics from the lead/booking/invoice tables
 * via the new `trpc.conversion.leadFunnel` admin-only query.
 */
function ConversionDashboard() {
  const { data, isLoading } = trpc.conversion.leadFunnel.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  if (isLoading || !data) {
    return (
      <section className="rounded-2xl border border-border/30 bg-card/40 p-8 text-center text-foreground/40 text-sm">
        Loading conversion funnel...
      </section>
    );
  }

  const t = data.totals;
  const bookingToInvoice = t.bookings30d > 0
    ? Math.round((t.invoices30d / t.bookings30d) * 1000) / 10
    : 0;

  // Sparkline rendering — pure SVG, no chart lib needed for 14 points.
  const trend = data.dailyTrend;
  const maxLeads = Math.max(1, ...trend.map((d) => d.leads));
  const maxBookings = Math.max(1, ...trend.map((d) => d.bookings));
  const sparkW = 280;
  const sparkH = 60;

  const linePoints = (vals: number[], max: number) => {
    if (vals.length === 0) return "";
    const stepX = sparkW / Math.max(1, vals.length - 1);
    return vals
      .map((v, i) => `${i * stepX},${sparkH - (v / max) * sparkH}`)
      .join(" ");
  };

  return (
    <section className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-bold text-2xl text-foreground tracking-tight flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Conversion Dashboard
          </h2>
          <p className="text-foreground/55 text-sm mt-1">
            30-day funnel rollup from leads → bookings → paid invoices. Updated every 60s.
          </p>
        </div>
        <div className="text-foreground/40 text-[11px] font-mono">
          As of {new Date(data.asOf).toLocaleTimeString()}
        </div>
      </header>

      {/* ─── TOP STATS ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Leads · 7d", value: t.leads7d, sub: `${t.leads30d} · 30d` },
          { label: "Bookings · 7d", value: t.bookings7d, sub: `${t.bookings30d} · 30d` },
          { label: "Lead → Book", value: `${data.leadToBookingRate}%`, sub: "30d phone-match" },
          { label: "Book → Paid", value: `${bookingToInvoice}%`, sub: `${t.invoices30d} paid · 30d` },
          { label: "Sources active", value: data.sources.length, sub: "Distinct channels" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/30 bg-card/50 p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-foreground/45 font-bold mb-1.5">
              {s.label}
            </div>
            <div className="font-heading text-2xl lg:text-3xl font-bold text-foreground tabular-nums">
              {s.value}
            </div>
            <div className="text-[11px] text-foreground/45 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ─── 14-DAY TREND + SOURCE BREAKDOWN ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-5">
        {/* Trend sparkline */}
        <div className="rounded-xl border border-border/30 bg-card/50 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-foreground/55">
              14-day trend
            </h3>
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider">
              <span className="flex items-center gap-1.5 text-primary">
                <span className="w-3 h-0.5 bg-primary" />
                Leads
              </span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-3 h-0.5 bg-emerald-400" />
                Bookings
              </span>
            </div>
          </div>
          {trend.length === 0 ? (
            <div className="text-foreground/40 text-xs italic py-8 text-center">
              No daily activity yet — sparkline will populate as leads come in.
            </div>
          ) : (
            <svg viewBox={`0 0 ${sparkW} ${sparkH}`} preserveAspectRatio="none" className="w-full h-16">
              <polyline
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="1.6"
                points={linePoints(trend.map((d) => d.leads), Math.max(maxLeads, maxBookings))}
              />
              <polyline
                fill="none"
                stroke="rgb(52 211 153)"
                strokeWidth="1.6"
                points={linePoints(trend.map((d) => d.bookings), Math.max(maxLeads, maxBookings))}
              />
            </svg>
          )}
          <div className="grid grid-cols-7 gap-1 mt-2 text-[9px] text-foreground/35 font-mono">
            {trend.slice(-7).map((d) => (
              <div key={d.date} className="text-center">
                {d.date.slice(5).replace("-", "/")}
              </div>
            ))}
          </div>
        </div>

        {/* Source breakdown */}
        <div className="rounded-xl border border-border/30 bg-card/50 p-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-foreground/55 mb-3 flex items-center gap-2">
            <Users className="w-3.5 h-3.5" />
            Lead sources · 30d
          </h3>
          {data.sources.length === 0 ? (
            <div className="text-foreground/40 text-xs italic py-6 text-center">
              No leads in the last 30 days.
            </div>
          ) : (
            <div className="space-y-2">
              {data.sources.map((s) => {
                const total = data.sources.reduce((sum, x) => sum + x.count, 0);
                const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                const label = SOURCE_LABELS[s.source] || s.source;
                return (
                  <div key={s.source}>
                    <div className="flex items-center justify-between text-[12px] mb-0.5">
                      <span className="text-foreground/75">{label}</span>
                      <span className="text-foreground/55 tabular-nums">
                        <span className="font-semibold text-foreground">{s.count}</span>
                        <span className="text-foreground/35"> · {pct}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-foreground/[0.05] overflow-hidden">
                      <div
                        className="h-full bg-primary/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

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
        title="Conversion Dashboard"
        subtitle="Funnel rollup at the top, live event feed in the middle, component sandbox below. The same components shipped to the public site render here for verification."
      />

      {/* ─── BATCH 9: CONVERSION DASHBOARD ─── */}
      <ConversionDashboard />

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
            relief="Used tires from $40, new from $89, installed in 20 min."
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
