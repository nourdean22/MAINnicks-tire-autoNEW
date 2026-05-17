"use client";

/**
 * TodayPulseStrip · v10.0.298 · 4-chip intelligence strip for Ultron HQ.
 *
 * Surfaces data the OS already collects but HQ doesn't show:
 *   · Weak identity axis · "Velocity" · from /api/actions-brain
 *   · Top-fired lens today · "Pareto · 4×" · from /api/system/lens-stats?days=1
 *   · VAPI calls today · "0 calls" / "1 active" · from /api/system/vapi-calls?days=1
 *   · System health · 🟢 "96%" / 🟡 / 🔴 · from /api/system/health
 *
 * Each chip is a tappable pill that deep-links to the relevant
 * dashboard. Layout is single-row scroll-x on mobile, flex-wrap on
 * desktop. Each chip uses the brand-anchor card vocabulary (rounded
 * border + var-token bg) so it inherits the gold-edge cascade from
 * v10.0.297.
 *
 * Per ELON delete-first: this strip is meant to REPLACE the v6 tools
 * counter strip (INDUSTRY/STORIES/TOP SCORE) which surfaces lower-
 * signal data than the OS's actual intelligence layer.
 */
import Link from "next/link";
import { Activity, Brain, DollarSign, Phone, Scale, Target } from "lucide-react";
import { useUltronFetch } from "@/lib/ultron/client-cache";
import { cn } from "@/lib/utils";

interface PulseData {
  weakAxis: string | null;
  maturity: number | null;
  topLens: { framework: string; count: number } | null;
  vapiCalls: number;
  vapiUrgent: number;
  health: { status: string; score: number } | null;
  // v10.0.299 · cost meter (5th chip) · daily AI burn
  costToday: number; // in cents
  costCalls: number; // total calls today
  // v10.0.529.29 · Arc B Phase 2 · contradictions chip · unresolved
  // count from the contradiction-surfacer pipeline. Tap → scrolls to
  // the ContradictionsCard via the #contradictions anchor on /ultron.
  // Same Scale icon the card's resolve toggle uses · keeps the visual
  // vocabulary consistent across surfaces.
  contradictionsUnresolved: number;
}

// v10.0.529.42 · EMPTY constant removed · post-refactor the data
// object is composed inline from 6 useUltronFetch hooks · there's
// no useState initial value needing a sentinel.

// v10.0.529.42 · cache-dedup refactor. Pre-fix this component fired
// 6 naked authedFetch calls on its own 90s interval, completely
// separate from the useUltronFetch cache the rest of /ultron uses.
// Same data (health · vapi · contradictions · ai-cost) was being
// double-fetched by other consumers (ObservabilityRow tiles ·
// ContradictionsCard · etc).
// Post-fix · 6 useUltronFetch hooks · one per endpoint · 90s TTL +
// poll cadence preserved. Every other consumer on /ultron now
// shares the same cache entry per URL · dedupe is automatic.
// Trade-off · 6 hook subscriptions per mount · React handles this
// cheaply · each chip re-renders only when ITS data changes.

interface BrainResponse {
  weakAxis?: string | null;
  maturity?: number | null;
}
interface LensResponse {
  topFrameworks?: Array<{ framework: string; count: number }>;
}
interface VapiResponse {
  totalCalls?: number;
  urgentCount?: number;
}
interface HealthResponse {
  status?: string;
  score?: number;
  overallStatus?: string;
}
interface CostResponse {
  today?: { totalCostCents?: number; totalCalls?: number };
}
interface ContradictionsResponse {
  summary?: { unresolved?: number };
}

const STRIP_CACHE_OPTS = { ttlMs: 90_000, pollMs: 90_000 } as const;

export function TodayPulseStrip() {
  // Six independent fetches · each cached + deduped by URL.
  const brainRaw = useUltronFetch<BrainResponse>("/api/actions-brain", STRIP_CACHE_OPTS);
  const lensRaw = useUltronFetch<LensResponse>(
    "/api/system/lens-stats?days=1",
    STRIP_CACHE_OPTS,
  );
  const vapiRaw = useUltronFetch<VapiResponse>(
    "/api/system/vapi-calls?days=1",
    STRIP_CACHE_OPTS,
  );
  const healthRaw = useUltronFetch<HealthResponse>("/api/system/health", STRIP_CACHE_OPTS);
  const costRaw = useUltronFetch<CostResponse>("/api/system/ai-cost", STRIP_CACHE_OPTS);
  const contradictionsRaw = useUltronFetch<ContradictionsResponse>(
    "/api/system/contradictions?days=14&includeResolved=false",
    STRIP_CACHE_OPTS,
  );

  // Don't render anything until at least one fetch has resolved ·
  // prevents the flicker of empty placeholders flashing in. Same
  // semantics as the pre-refactor "wait for all in Promise.all then
  // setLoading(false)" pattern · the OR-of-six is the AND-equivalent
  // when each individual fetch may still be loading on first mount.
  const loading =
    brainRaw.loading &&
    lensRaw.loading &&
    vapiRaw.loading &&
    healthRaw.loading &&
    costRaw.loading &&
    contradictionsRaw.loading;
  if (loading) return null;

  // Compose data from the six caches · same shape the rest of the
  // component already consumes. Null-safe defaults preserved.
  const brain = brainRaw.data ?? {};
  const lens = lensRaw.data ?? {};
  const vapi = vapiRaw.data ?? {};
  const health = healthRaw.data ?? {};
  const cost = costRaw.data ?? {};
  const contradictions = contradictionsRaw.data ?? {};

  const top = lens.topFrameworks?.find((f) => f.framework !== "(fallback)");
  const healthStatus = (health.status ?? health.overallStatus ?? "healthy").toLowerCase();
  const healthScore = typeof health.score === "number" ? health.score : 100;

  const data: PulseData = {
    weakAxis: brain.weakAxis ?? null,
    maturity: brain.maturity ?? null,
    topLens: top ? { framework: top.framework, count: top.count } : null,
    vapiCalls: vapi.totalCalls ?? 0,
    vapiUrgent: vapi.urgentCount ?? 0,
    health: { status: healthStatus, score: healthScore },
    costToday: cost.today?.totalCostCents ?? 0,
    costCalls: cost.today?.totalCalls ?? 0,
    contradictionsUnresolved: contradictions.summary?.unresolved ?? 0,
  };

  // If every signal is empty, render silently · no point showing four
  // dim "no data" chips on a fresh OS.
  const hasAnySignal =
    data.weakAxis ||
    data.topLens ||
    data.vapiCalls > 0 ||
    data.costToday > 0 ||
    data.contradictionsUnresolved > 0 ||
    (data.health && data.health.status !== "healthy");
  if (!hasAnySignal && data.maturity === null) return null;

  const healthTone = (() => {
    const s = data.health?.status ?? "healthy";
    if (s.includes("critical") || s.includes("red")) return "rose";
    if (s.includes("degrad") || s.includes("warn") || s.includes("amber") || s.includes("yellow")) return "amber";
    return "emerald";
  })();

  const vapiTone = data.vapiUrgent > 0 ? "rose" : data.vapiCalls > 0 ? "gold" : "neutral";

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      <Chip
        href="/brain"
        icon={<Brain size={11} />}
        label="WEAK AXIS"
        value={data.weakAxis ? humanize(data.weakAxis) : "—"}
        sub={data.maturity !== null ? `mat ${data.maturity}` : undefined}
        tone={data.weakAxis ? "amber" : "neutral"}
      />
      {/* v10.0.529.26 · violet → gold · violet/purple is on the
          standing-directive's anti-AI-slop color list (along with
          Inter, symmetric layouts, uniform rounded corners). Gold
          is this OS's dominant aesthetic anchor · the TOP LENS
          chip joins the WEAK AXIS / VAPI / HEALTH / AI-COST family
          which already uses the tonal vocabulary. */}
      <Chip
        href="/system/lens-stats"
        icon={<Target size={11} />}
        label="TOP LENS"
        value={data.topLens?.framework ?? "—"}
        sub={data.topLens ? `${data.topLens.count}× today` : undefined}
        tone={data.topLens ? "gold" : "neutral"}
      />
      <Chip
        href="/system/vapi-calls"
        icon={<Phone size={11} />}
        label="VAPI"
        value={`${data.vapiCalls}${data.vapiCalls === 1 ? " call" : " calls"}`}
        sub={data.vapiUrgent > 0 ? `${data.vapiUrgent} urgent` : "today"}
        tone={vapiTone}
      />
      <Chip
        href="/system/health"
        icon={<Activity size={11} />}
        label="HEALTH"
        value={`${data.health?.score ?? "—"}${typeof data.health?.score === "number" ? "%" : ""}`}
        sub={data.health?.status ?? "—"}
        tone={healthTone}
      />
      {/* v10.0.299 · cost meter chip · daily AI spend with call count.
          Tone scales · neutral under $0.50, gold under $5, amber up
          to $15, rose above (rough thresholds tuned for operator-
          grade burn rather than enterprise scale). */}
      <Chip
        href="/system/ai-cost"
        icon={<DollarSign size={11} />}
        label="AI COST"
        value={data.costToday > 0 ? `$${(data.costToday / 100).toFixed(2)}` : "$0"}
        sub={data.costCalls > 0 ? `${data.costCalls} calls` : "today"}
        tone={
          data.costToday >= 1500 ? "rose" :
          data.costToday >= 500 ? "amber" :
          data.costToday >= 50 ? "gold" :
          "neutral"
        }
      />
      {/* v10.0.529.29 · Arc B Phase 2 · POSITIONS chip · only renders
          when there are unresolved contradictions · zero-noise on a
          clean board. Same Scale icon the ContradictionsCard resolve
          toggle uses · visually anchors the tap-target to its
          destination. Tone is gold (≤2) / amber (3-5) / rose (6+) ·
          mirrors the severity scaling the rest of the chip family
          uses (cost burn, urgent VAPI). Href is "#contradictions" ·
          Next.js Link with hash-only URL scrolls to the anchor div
          wrapping ContradictionsCard, with scroll-mt-24 keeping the
          card below the sticky TopStrip. */}
      {data.contradictionsUnresolved > 0 && (
        <Chip
          href="#contradictions"
          icon={<Scale size={11} />}
          label="POSITIONS"
          value={`${data.contradictionsUnresolved} unresolved`}
          sub="to reconcile"
          tone={
            data.contradictionsUnresolved >= 6
              ? "rose"
              : data.contradictionsUnresolved >= 3
                ? "amber"
                : "gold"
          }
        />
      )}
    </div>
  );
}

interface ChipProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: "gold" | "amber" | "rose" | "emerald" | "neutral";
}

// v10.0.529.26 · violet tone removed · standing-directive bans purple
// gradients as AI-slop. The remaining 5 tones cover the full chip
// state space (success/info/warn/critical/quiet) without it.
const TONE_CLASSES: Record<ChipProps["tone"], string> = {
  gold: "border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] text-[var(--gold)]",
  amber: "border-amber-500/30 bg-amber-500/[0.03] text-amber-300",
  rose: "border-rose-500/30 bg-rose-500/[0.04] text-rose-300",
  emerald: "border-emerald-500/30 bg-emerald-500/[0.03] text-emerald-300",
  neutral: "border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-tertiary)]",
};

function Chip({ href, icon, label, value, sub, tone }: ChipProps) {
  return (
    <Link
      href={href}
      data-no-anchor
      className={cn(
        "group flex-1 min-w-[110px] rounded-lg border px-2.5 py-1.5 transition-all",
        "hover:scale-[1.02] hover:brightness-110",
        TONE_CLASSES[tone],
      )}
    >
      <div className="flex items-center gap-1 text-[8px] font-mono uppercase tracking-wider opacity-70">
        <span className="opacity-80">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-0.5 font-[var(--font-display)] text-[13px] font-bold tabular-nums leading-tight truncate">
        {value}
      </div>
      {sub && (
        <div className="text-[8px] font-mono opacity-60 leading-tight truncate mt-0.5">
          {sub}
        </div>
      )}
    </Link>
  );
}

function humanize(axisKey: string): string {
  return axisKey
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
