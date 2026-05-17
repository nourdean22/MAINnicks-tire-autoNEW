"use client";

/**
 * /relationships — operator surface for the people-intelligence layer.
 * v10.0.529.106 · Wave 67.
 *
 * The 218-LOC people-intelligence engine has been building
 * PersonProfile rows + trust scores + neglect detection for months ·
 * pre-Wave-67 there was no operator-facing surface. The engine fired
 * alerts into the system prompt and that was it.
 *
 * This page surfaces the full set with:
 *   · sort modes: recent · trust · neglect
 *   · neglect badge: 14+ days since interaction (3+ interaction count)
 *   · trust tier color: emerald ≥0.7 · sky 0.4-0.69 · zinc <0.4
 *   · tap-to-open chat seeded with the person's name + context
 *
 * Editorial-minimalist · gold-on-dark · dense info-per-pixel.
 */

import { StandardPage } from "@/components/layout/standard-page";
import { usePollingFetch } from "@/hooks/use-polling-fetch";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface PersonRow {
  id: string;
  name: string;
  role: string;
  relationship: string;
  trustScore: number;
  leverageNotes: string | null;
  lastInteraction: string | null;
  interactionCount: number;
  daysSinceInteraction: number | null;
  isNeglected: boolean;
}

interface PeopleResponse {
  people: PersonRow[];
  totals: {
    total: number;
    neglected: number;
    high_trust: number;
    sparse: number;
  };
  generatedAt: string;
}

type SortKey = "recent" | "trust" | "neglect";
const VALID_SORTS = ["recent", "trust", "neglect"] as const;

function trustTone(score: number): { bg: string; text: string } {
  if (score >= 0.7) return { bg: "bg-emerald-500/[0.08] border-emerald-500/30", text: "text-emerald-200" };
  if (score >= 0.4) return { bg: "bg-sky-500/[0.08] border-sky-500/30", text: "text-sky-200" };
  return { bg: "bg-zinc-500/[0.08] border-zinc-500/30", text: "text-zinc-300" };
}

function relativeTime(daysSince: number | null): string {
  if (daysSince === null) return "—";
  if (daysSince === 0) return "today";
  if (daysSince === 1) return "1d ago";
  if (daysSince < 30) return `${daysSince}d ago`;
  if (daysSince < 365) return `${Math.round(daysSince / 30)}mo ago`;
  return `${Math.round(daysSince / 365)}y ago`;
}

export default function RelationshipsPage() {
  const [sortKey, setSortKey] = useLocalStorageState<SortKey>(
    "relationships:sortKey",
    "recent",
    VALID_SORTS,
  );
  const { data, loading, error, reload } = usePollingFetch<PeopleResponse>(
    `/api/people?sort=${sortKey}&limit=100`,
    { intervalMs: 5 * 60_000 }, // 5min · people change slowly
  );

  return (
    <StandardPage
      eyebrow="brain · relationships"
      title="people"
      description="The people-intelligence layer · trust scores · neglect detection · tap any name to open chat seeded with their context"
      rhythm="comfortable"
      width="2xl"
      actions={
        <FreshnessChip
          lastFetchedAt={data?.generatedAt}
          source="people-intelligence engine"
          onReload={reload}
        />
      }
    >
      {/* Rollup strip · 4 totals · helps the operator orient before scrolling */}
      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="total" value={data.totals.total} tint="text-[var(--text-primary)]" />
          <Stat
            label="neglected"
            value={data.totals.neglected}
            tint={data.totals.neglected > 0 ? "text-amber-300" : "text-zinc-500"}
          />
          <Stat
            label="high trust"
            value={data.totals.high_trust}
            tint="text-emerald-300"
          />
          <Stat
            label="sparse"
            value={data.totals.sparse}
            tint={data.totals.sparse > 5 ? "text-amber-300" : "text-zinc-500"}
          />
        </div>
      )}

      {/* Sort dropdown */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          {sortKey === "neglect" ? "needs attention" : sortKey === "trust" ? "highest trust" : "most recent"}
        </h2>
        <SortDropdown
          value={sortKey}
          onChange={(v) => setSortKey(v as SortKey)}
          ariaLabel="Sort people"
          options={[
            { value: "recent", label: "most recent first" },
            { value: "trust", label: "trust · highest first" },
            { value: "neglect", label: "neglected first" },
          ]}
        />
      </div>

      {/* People list · tap-to-chat pattern · each row deep-links to
          /chat?q=remind me about <name> · the chat layer hydrates the
          person's profile + last interactions via existing brain blocks */}
      {data && data.people.length === 0 && !loading && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-6 text-center text-sm text-[var(--text-tertiary)]">
          No people profiles yet · the people-intelligence engine builds
          these from your chat history. Open a few chat conversations
          that mention specific people, then check back.
        </div>
      )}

      {data && data.people.length > 0 && (
        <div className="grid gap-2">
          {data.people.map((p) => {
            const tone = trustTone(p.trustScore);
            const chatHref = `/chat?q=${encodeURIComponent(`remind me about ${p.name}`)}`;
            return (
              <Link
                key={p.id}
                href={chatHref}
                className={cn(
                  "block rounded-lg border p-3 transition-all hover:scale-[1.005] active:scale-[0.99]",
                  tone.bg,
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-sm font-semibold truncate", tone.text)}>
                        {p.name}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                        {p.role}
                      </span>
                      {p.isNeglected && (
                        <Badge className="h-auto rounded px-1.5 py-0.5 bg-transparent border-amber-500/30 text-amber-300 text-[10px] font-normal uppercase tracking-wider">
                          neglected
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">
                      {p.relationship || "no relationship notes"}
                    </p>
                    {p.leverageNotes && (
                      <p className="mt-1 text-[11px] italic text-[var(--text-tertiary)] line-clamp-1">
                        leverage: {p.leverageNotes}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                      trust
                    </div>
                    <div className={cn("text-lg font-mono font-bold tabular-nums", tone.text)}>
                      {Math.round(p.trustScore * 100)}
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
                      {relativeTime(p.daysSinceInteraction)} · {p.interactionCount}×
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {loading && !data && (
        <div className="text-sm text-[var(--text-tertiary)]">loading people…</div>
      )}
      {error && !data && (
        <div className="text-sm text-rose-300">people-intelligence unavailable · tap reload</div>
      )}
    </StandardPage>
  );
}

function Stat({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-3 text-center">
      <div className={cn("text-2xl font-bold font-mono tabular-nums", tint)}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </div>
    </div>
  );
}
