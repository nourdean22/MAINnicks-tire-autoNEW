"use client";

/**
 * /system/cockpit — unified operator cockpit · v10.0.529.106 · Wave 65.
 *
 * Single pane of glass for the OS health check. 5 scorecards (cost
 * today · eval pass rate · cron success · chat turns · voice p50)
 * aggregated by /api/system/cockpit.
 *
 * Pre-Wave-65 there were 22+ scattered /system/* dashboards. Operator
 * had to visit /system/costs · /system/chat-health · /system/cron-runs
 * etc to assemble mental health check. Cockpit collapses this into a
 * 30-second morning ritual surface.
 *
 * Editorial-minimalist · gold-on-dark · 5-card grid that flows to
 * single-column on mobile. Status colors only when state ≠ ok ·
 * the rest is restraint.
 */

import { StandardPage } from "@/components/layout/standard-page";
import { usePollingFetch } from "@/hooks/use-polling-fetch";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface ScoreCard {
  key: string;
  label: string;
  value: string;
  numeric: number | null;
  status: "ok" | "warn" | "alert";
  detail: string;
}

interface CockpitData {
  generatedAt: string;
  scorecards: ScoreCard[];
  headlineStatus: "ok" | "warn" | "alert";
}

const STATUS_TONE: Record<ScoreCard["status"], string> = {
  ok: "border-[var(--border-default)] bg-[var(--bg-raised)]",
  warn: "border-amber-500/30 bg-amber-500/[0.04]",
  alert: "border-rose-500/40 bg-rose-500/[0.05]",
};

const STATUS_VALUE_TONE: Record<ScoreCard["status"], string> = {
  ok: "text-[var(--text-primary)]",
  warn: "text-amber-300",
  alert: "text-rose-300",
};

// Deep links per scorecard · tap the card to drill into the
// corresponding sub-dashboard.
const SCORECARD_LINK: Record<string, string> = {
  cost: "/system/costs",
  eval: "/system/anti-patterns?view=evals",
  cron: "/system/cron-runs",
  chat: "/system/chat-health",
  voice: "/system/vapi-calls",
};

export default function CockpitPage() {
  const { data, loading, error, reload } = usePollingFetch<CockpitData>(
    "/api/system/cockpit",
    { intervalMs: 60_000 },
  );

  return (
    <StandardPage
      eyebrow="system · cockpit"
      title="operator cockpit"
      description="Single-pane-of-glass OS health · refreshes every 60s · tap any card to drill in"
      rhythm="comfortable"
      width="2xl"
      actions={
        <FreshnessChip
          lastFetchedAt={data?.generatedAt}
          source="cockpit aggregate"
          onReload={reload}
        />
      }
    >
      {/* Headline status banner · only renders when state ≠ ok so
          green-everything surfaces stay quiet. Editorial-minimalist
          restraint · ambient signal vs always-on chrome. */}
      {data && data.headlineStatus !== "ok" && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            data.headlineStatus === "alert"
              ? "border-rose-500/40 bg-rose-500/[0.06] text-rose-200"
              : "border-amber-500/40 bg-amber-500/[0.06] text-amber-200",
          )}
        >
          {data.headlineStatus === "alert"
            ? "OS reports one or more red signals · investigate the alert-tone cards below"
            : "OS reports one or more amber signals · worth a glance"}
        </div>
      )}

      {/* 5-scorecard grid · grid-cols-2 on mobile (5 cards = 3+2)
          · grid-cols-5 on lg so all cards sit on one row at desktop.
          Mobile-fit per Wave 51 mobile guidelines. */}
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {data.scorecards.map((c) => {
            const href = SCORECARD_LINK[c.key] ?? "/system";
            return (
              <Link
                key={c.key}
                href={href}
                className={cn(
                  "block rounded-lg border p-4 transition-all hover:scale-[1.02] active:scale-[0.98]",
                  STATUS_TONE[c.status],
                )}
              >
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                  {c.label}
                </div>
                <div className={cn("mt-1 text-3xl font-bold tabular-nums", STATUS_VALUE_TONE[c.status])}>
                  {c.value}
                </div>
                <div className="mt-1 text-[11px] text-[var(--text-tertiary)] line-clamp-2">
                  {c.detail}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {loading && !data && (
        <div className="text-sm text-[var(--text-tertiary)]">loading cockpit…</div>
      )}
      {error && !data && (
        <div className="text-sm text-rose-300">cockpit unavailable · tap reload</div>
      )}

      {/* Editorial footer · "this is the cockpit · here's what it
          covers" · short orientation that doesn't take up much room
          but tells the operator what's NOT in this view. */}
      <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.5] p-4 text-xs text-[var(--text-tertiary)]">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">about this view</div>
        <p>
          The 5 cards above are the highest-signal OS health metrics aggregated from
          the 22+ /system/* sub-dashboards. Green = within target · amber = drifting ·
          red = breach. Tap any card to open the corresponding sub-dashboard with full
          history + drill-downs.
        </p>
        <p className="mt-2">
          What's NOT here: brain-layer health (see <Link href="/brain" className="text-[var(--gold)] underline-offset-2 hover:underline">/brain</Link>),
          mastery scores (see <Link href="/mastery" className="text-[var(--gold)] underline-offset-2 hover:underline">/mastery</Link>),
          business signals (those live on nickstire admin per OS separation rule).
        </p>
      </div>
    </StandardPage>
  );
}
