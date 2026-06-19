"use client";

/**
 * HQErrorsCard — surfaces recent errors directly on HQ.
 *
 * Principle: "silent degradation is the enemy." Errors happen on every
 * release. Without something ambient, Nour never sees them unless he
 * thinks to open /system/errors. This card puts the top fingerprints
 * on the morning view the moment there are any in the last 24h — and
 * hides itself when the log is clean.
 *
 * Uses the grouped=true endpoint so 186 identical errors become ONE
 * row with a "×186" count chip. Otherwise a single recurring bug
 * drowns out every other message in the top-3.
 *
 * Render policy (subtle by default):
 *   · 0 errors 24h → card does NOT render (silent = healthy).
 *   · 1-5 errors 24h → amber strip, compact list.
 *   · 6+ errors 24h OR any fatal-level group → rose with pulse.
 *
 * Click any row → deep-link to /system/logs?view=errors so you land
 * on the grouped fingerprint deck (absorbed from /errors in v10.0.306).
 * Per-message deep-link is dropped · the fingerprint deck shows all
 * top-20 ranked by count which is the more useful default.
 */

import Link from "next/link";
import { AlertCircle, AlertTriangle, ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

interface ErrorGroup {
  message: string;
  count: number;
  lastSeen: string | null;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function HQErrorsCard() {
  // Phase B.6c (2026-05-22) · migrated off `authedFetch("/api/system/
  // errors?from=<24h-ago>&grouped=true")` onto `trpc.system.errorsGrouped`.
  // The legacy `?from=<ISO>` 24h cutoff is now `sinceHours: 24` (the
  // procedure converts hours → a `from` Date server-side). The
  // 2-min setInterval is now `refetchInterval`; the legacy
  // `cache: "no-store"` semantics are preserved by `staleTime: 0` so
  // every refetch hits the server fresh. The procedure returns
  // `{ groups }` directly · the legacy `json.data` envelope unwrap
  // is gone. Fetch failures leave `data` undefined → the card stays
  // hidden, exactly as the old silent-catch did.
  const { data } = trpc.system.errorsGrouped.useQuery(
    { sinceHours: 24 },
    { refetchInterval: 2 * 60_000, staleTime: 0 },
  );

  if (!data) return null;
  const groups: ErrorGroup[] = Array.isArray(data.groups) ? data.groups : [];
  const count24h = groups.reduce((s, g) => s + g.count, 0);
  if (count24h === 0) return null;

  const distinctCount = groups.length;
  const topGroupCount = groups[0]?.count ?? 0;
  // A single fingerprint with ≥20 hits OR 6+ distinct messages = rose.
  // Otherwise amber.
  const critical = topGroupCount >= 20 || distinctCount >= 6;

  const pal = critical
    ? {
        border: "border-rose-500/40",
        bg: "bg-rose-500/[0.08]",
        text: "text-rose-200",
        dot: "bg-rose-400 animate-pulse",
      }
    : {
        border: "border-amber-500/35",
        bg: "bg-amber-500/[0.06]",
        text: "text-amber-200",
        dot: "bg-amber-400",
      };

  const Icon = critical ? AlertCircle : AlertTriangle;

  return (
    <section
      aria-label="Recent errors"
      className={cn("rounded-xl border backdrop-blur-sm", pal.border, pal.bg)}
    >
      <header className="flex items-center gap-2 px-3 py-2 text-sm">
        <span className={cn("h-2 w-2 rounded-full", pal.dot)} />
        <Icon className={cn("h-4 w-4", pal.text)} />
        <span className={cn("font-semibold", pal.text)}>
          {count24h} error{count24h === 1 ? "" : "s"} 24h
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
          · {distinctCount} distinct
        </span>
        <Link
          href="/system/logs?view=errors"
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:border-white/20 hover:text-[var(--text-primary)] transition-colors"
        >
          <span>view all</span>
          <ArrowRight className="h-3 w-3" />
        </Link>
      </header>
      <ul className="space-y-0 border-t border-white/5 px-3 py-1.5 text-xs">
        {groups.slice(0, 3).map((g, i) => (
          <li key={i} className="flex items-start gap-2 py-1">
            <span
              className={cn(
                "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                g.count >= 20 ? "bg-rose-500" : "bg-rose-400",
              )}
            />
            <Link
              href="/system/logs?view=errors"
              className="flex-1 min-w-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <span className="truncate block" title={g.message}>
                {g.message}
              </span>
            </Link>
            <span
              className={cn(
                "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                g.count >= 20
                  ? "border-rose-500/45 bg-rose-500/15 text-rose-200"
                  : g.count >= 5
                    ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                    : "border-white/10 bg-white/5 text-[var(--text-tertiary)]",
              )}
            >
              ×{g.count}
            </span>
            <span className="shrink-0 text-[10px] text-[var(--text-tertiary)] tabular-nums">
              {g.lastSeen ? timeAgo(g.lastSeen) : "—"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
