"use client";

/**
 * /system/anti-patterns — library of "I tried X, failed, reason Y"
 * (W12.4).
 *
 * Explicit log. Surfaced here + by a future Nick tool
 * `checkAntiPattern(intent)` that greps the library when current
 * intent matches past failures. Point is devastating lead: Nour
 * compounds lessons instead of re-treading.
 *
 * Controls:
 *   · add form (attempt / outcome / lesson / severity / domain / tags)
 *   · filter chips by domain + severity
 *   · per-entry revisit button (bumps revisitCount)
 *   · per-entry delete
 *   · summary strip (total · by domain · by severity)
 *
 * Alive:
 *   · severity tint (critical rose / warn amber / info sky)
 *   · revisit pulse on entries revisited in last 7d
 *   · form shake on validation fail
 */

import { useState, useMemo } from "react";
import { Panel } from "@/components/panel";
// PageHeader removed · parent /system/quality page provides one
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { TrendCounter } from "@/components/ui/trend-counter";
import { DecisionSpread } from "@/components/ui/decision-spread";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

import { trpc } from "@/lib/trpc/client";
import { relativeTimeSeconds as timeAgo } from "@/lib/utils/datetime";
type Severity = "info" | "warn" | "critical";
type Domain = "business" | "personal" | "tech" | "health" | "relationships" | "other";

interface Item {
  key: string;
  lesson: string;
  attempt: string;
  outcome: string;
  severity: Severity;
  domain: Domain;
  firstTriedAt: string;
  lastRevisitedAt: string | null;
  revisitCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
interface Feed {
  items: Item[];
  summary: {
    total: number;
    byDomain: Record<Domain, number>;
    bySeverity: Record<Severity, number>;
    oldestAt: string | null;
  };
}

const SEVERITY_TINT: Record<Severity, string> = {
  critical: "border-rose-500/30 bg-rose-500/[0.03] text-rose-300",
  warn: "border-amber-500/30 bg-amber-500/[0.03] text-amber-300",
  info: "border-sky-500/30 bg-sky-500/[0.03] text-sky-300",
};
const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-rose-500",
  warn: "bg-amber-500",
  info: "bg-sky-500",
};
// v10.0.217 · industrial code instead of emoji. Anti-slop alignment
// — the operator UI brand stance is "void black command center", not
// SaaS-card cute. 3-letter caps live in the same cognitive bucket as
// stock tickers / radio call-signs · scannable at any text size.
const DOMAIN_CODE: Record<Domain, string> = {
  business: "BIZ",
  personal: "PER",
  tech: "TEC",
  health: "HLT",
  relationships: "REL",
  other: "OTH",
};

// v10.0.217 · compound = severity_rank × (1 + log2(revisitCount + 1)).
// Rationale: each revisit COMPOUNDS the lesson's value (you've now
// re-encountered the same trap and stayed away). Log dampens the
// reward so a single high-revisit lesson doesn't dominate. Severity
// weights it because a critical revisit is worth more than an info one.
const SEVERITY_WEIGHT: Record<Severity, number> = { info: 1, warn: 2, critical: 4 };
function compoundScore(item: { severity: Severity; revisitCount: number }): number {
  return SEVERITY_WEIGHT[item.severity] * (1 + Math.log2(item.revisitCount + 1));
}
/** Estimated time saved per compound point — heuristic, not measured.
 *  20 min per compound point = a critical-twice lesson saves ~80 min. */
const MINUTES_PER_COMPOUND = 20;

export function QualityLessonsView() {
  // iOS-PWA-safe confirm · window.confirm() is silently suppressed in
  // standalone mode so the delete guard always took the cancel path.
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [domainFilter, setDomainFilter] = useState<Domain | "all">("all");
  const [sevFilter, setSevFilter] = useState<Severity | "all">("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [form, setForm] = useState({
    key: "",
    attempt: "",
    outcome: "",
    lesson: "",
    severity: "warn" as Severity,
    domain: "business" as Domain,
    tags: "",
  });

  // Phase VV (2026-05-22) · REST→tRPC · the library read is a typed
  // query (system.antiPatterns); create / revisit / delete are three
  // typed mutations. The legacy routes all returned their payload
  // directly (no `{data}` wrap). After every mutation the read query is
  // invalidated so the list re-runs, matching the prior `await load()`.
  // FreshnessChip's timestamp comes from React Query's dataUpdatedAt.
  const utils = trpc.useUtils();
  const lessonsQuery = trpc.systemBrain.antiPatterns.useQuery();
  const feed: Feed | null = lessonsQuery.data ?? null;
  const loading = lessonsQuery.isPending;
  const fetchedAt = lessonsQuery.dataUpdatedAt
    ? new Date(lessonsQuery.dataUpdatedAt).toISOString()
    : null;
  const load = () => void lessonsQuery.refetch();

  const createMutation = trpc.systemBrain.createAntiPattern.useMutation();
  const revisitMutation = trpc.systemBrain.revisitAntiPattern.useMutation();
  const deleteMutation = trpc.systemBrain.deleteAntiPattern.useMutation();
  const saving = createMutation.isPending;

  const filtered = useMemo(() => {
    if (!feed) return [];
    return feed.items.filter((i) => {
      if (domainFilter !== "all" && i.domain !== domainFilter) return false;
      if (sevFilter !== "all" && i.severity !== sevFilter) return false;
      return true;
    });
  }, [feed, domainFilter, sevFilter]);

  // v10.0.217 · Compound Index — turn list-of-lessons into a felt
  // value the operator can read at a glance. Sums compoundScore across
  // every entry so the header answers "what is this library worth?"
  // not just "how many rows are there?"
  const compound = useMemo(() => {
    if (!feed) return { sum: 0, totalRevisits: 0, estimatedMinutes: 0, byDomain: {} as Partial<Record<Domain, number>> };
    let sum = 0;
    let totalRevisits = 0;
    const byDomain: Partial<Record<Domain, number>> = {};
    for (const i of feed.items) {
      const c = compoundScore(i);
      sum += c;
      totalRevisits += i.revisitCount;
      byDomain[i.domain] = (byDomain[i.domain] ?? 0) + c;
    }
    return {
      sum: Math.round(sum * 10) / 10,
      totalRevisits,
      estimatedMinutes: Math.round(sum * MINUTES_PER_COMPOUND),
      byDomain,
    };
  }, [feed]);

  async function submit() {
    if (!form.key || !form.attempt || !form.outcome || !form.lesson) {
      toast.error("all required fields must be filled");
      return;
    }
    const keyNormalized = form.key.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!keyNormalized) {
      toast.error("key must contain at least one letter or number");
      return;
    }
    try {
      const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const res = await createMutation.mutateAsync({
        key: keyNormalized,
        attempt: form.attempt,
        outcome: form.outcome,
        lesson: form.lesson,
        severity: form.severity,
        domain: form.domain,
        tags,
      });
      toast.success(`${keyNormalized} ${res.action ?? "saved"}`);
      setForm({ key: "", attempt: "", outcome: "", lesson: "", severity: "warn", domain: "business", tags: "" });
      setShowForm(false);
      await utils.system.antiPatterns.invalidate();
    } catch (e) {
      toast.error(`save failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function revisit(key: string) {
    try {
      const res = await revisitMutation.mutateAsync({ key });
      toast.success(`revisited ${key} · total ${res.revisitCount}×`);
      await utils.system.antiPatterns.invalidate();
    } catch (e) {
      toast.error(`revisit failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function remove(key: string) {
    const ok = await confirm({
      title: `delete anti-pattern "${key}"?`,
      body: "this is not reversible.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync({ key });
      toast.success(`deleted ${key}`);
      await utils.system.antiPatterns.invalidate();
    } catch (e) {
      toast.error(`delete failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  const toggle = (key: string) => {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  return (
    <div className="space-y-4">
      {/* PageHeader removed · parent /system/quality renders title.
          Inline mini-row keeps freshness chip + add-lesson toggle. */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
        <span>
          {feed
            ? `${feed.summary.total} lessons · ${compound.totalRevisits} total revisits · the library compounds the longer you use it`
            : "loading…"}
        </span>
        <div className="flex items-center gap-2">
          <FreshnessChip
            lastFetchedAt={fetchedAt}
            source="db · BrainMemory(anti_pattern)"
            onReload={load}
          />
          <button
            onClick={() => setShowForm((v) => !v)}
            className={cn(
              "rounded-lg border px-3 py-1 text-xs font-medium transition",
              showForm
                ? "border-zinc-600 bg-zinc-800 text-zinc-200"
                : "border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20",
            )}
          >
            {showForm ? "× close" : "+ add lesson"}
          </button>
        </div>
      </div>

      {/* v10.0.217 · Compound Index strip — makes the library FELT.
          Five cards: total · critical · warn · revisits · estimated saved.
          The estimated-minutes card reframes the data emotionally:
          "this library has earned itself ~38h of avoided repeats." */}
      {feed && feed.summary.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <TrendCounter
            value={feed.summary.total}
            label="lessons"
            goodWhen="high"
            tone="gold"
          />
          <TrendCounter
            value={feed.summary.bySeverity.critical}
            label="critical"
            goodWhen="low"
            tone={feed.summary.bySeverity.critical > 0 ? "rose" : "tertiary"}
          />
          <TrendCounter
            value={feed.summary.bySeverity.warn}
            label="warn"
            goodWhen="low"
            tone={feed.summary.bySeverity.warn > 0 ? "amber" : "tertiary"}
          />
          <TrendCounter
            value={compound.totalRevisits}
            label="revisits"
            goodWhen="high"
            tone="emerald"
          />
          <TrendCounter
            value={compound.estimatedMinutes}
            label="min saved"
            goodWhen="high"
            tone="emerald"
            format={(n) => n >= 60 ? `${(n / 60).toFixed(n >= 600 ? 0 : 1)}h` : `${n}m`}
          />
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <Panel className="border-emerald-500/30 bg-emerald-500/[0.02]">
          <h3 className="mb-3 text-sm font-semibold text-emerald-300">new lesson</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">tag · lowercase + hyphens</label>
              <input
                type="text"
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                placeholder="e.g. pricing-by-feel"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">tags · comma separated</label>
              <input
                type="text"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="pricing, quote, churn"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">what I tried</label>
              <input
                type="text"
                value={form.attempt}
                onChange={(e) => setForm({ ...form, attempt: e.target.value })}
                placeholder="the attempted action in one sentence"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">what happened (failure / cost)</label>
              <input
                type="text"
                value={form.outcome}
                onChange={(e) => setForm({ ...form, outcome: e.target.value })}
                placeholder="the outcome — blunt, specific, numeric when possible"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">lesson · what to remember</label>
              <textarea
                rows={3}
                value={form.lesson}
                onChange={(e) => setForm({ ...form, lesson: e.target.value })}
                placeholder="the one-sentence rule that will save future-you"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">severity</label>
              <div className="flex gap-2">
                {(["info", "warn", "critical"] as Severity[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setForm({ ...form, severity: s })}
                    className={cn(
                      "flex-1 rounded-md px-3 py-2 text-xs transition",
                      form.severity === s ? SEVERITY_TINT[s] + " border" : "border border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">domain</label>
              <select
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value as Domain })}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500/60 focus:outline-none"
              >
                {(["business", "personal", "tech", "health", "relationships", "other"] as Domain[]).map((d) => (
                  <option key={d} value={d}>{DOMAIN_CODE[d]} · {d}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs text-zinc-300 hover:bg-zinc-700"
            >
              cancel
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="rounded-md border border-emerald-500/50 bg-emerald-500/20 px-4 py-2 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {saving ? "saving…" : "save lesson"}
            </button>
          </div>
        </Panel>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setDomainFilter("all")}
          className={cn("rounded-full px-3 py-1 text-xs transition", domainFilter === "all" ? "bg-white/10 text-white" : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60")}
        >
          all domains
        </button>
        {(["business", "personal", "tech", "health", "relationships", "other"] as Domain[]).map((d) => (
          <button
            key={d}
            onClick={() => setDomainFilter(d === domainFilter ? "all" : d)}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition",
              domainFilter === d
                ? "border border-[var(--gold)]/40 bg-[var(--gold)]/[0.08] text-[var(--gold)]"
                : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
            )}
          >
            <span className="font-mono text-[10px] tracking-wider mr-1.5 opacity-80">{DOMAIN_CODE[d]}</span>
            {d} · <AnimatedCounter value={feed?.summary.byDomain[d] ?? 0} />
          </button>
        ))}
        <span className="text-xs text-zinc-600">·</span>
        {(["info", "warn", "critical"] as Severity[]).map((s) => (
          <button
            key={s}
            onClick={() => setSevFilter(s === sevFilter ? "all" : s)}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition",
              sevFilter === s ? SEVERITY_TINT[s] + " border" : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
            )}
          >
            {s} · <AnimatedCounter value={feed?.summary.bySeverity[s] ?? 0} />
          </button>
        ))}
      </div>

      {/* v10.0.217 · DecisionSpread cards · attempt ↔ outcome with the
          lesson promoted to leftBody (the most important field, was
          previously hidden inside an accordion). The compound score
          rides the connector — severity_weight × log2(revisits + 1).
          Recently-revisited lessons get a faint amber outline pulse. */}
      {filtered.length === 0 ? (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <div className="py-8 text-center text-zinc-500">
            <div className="mb-2 text-sm">
              {loading
                ? "loading…"
                : feed && feed.summary.total === 0
                  ? "no lessons yet"
                  : "nothing matches the filters"}
            </div>
            {feed && feed.summary.total === 0 && (
              <div className="text-xs">
                click <span className="text-emerald-300">+ add lesson</span> above to log your first one.
                <br />the library compounds — every entry saves future-you a repeat.
              </div>
            )}
          </div>
        </Panel>
      ) : (
        <div className="space-y-3">
          {filtered.map((i) => {
            const wasRecentlyRevisited =
              i.lastRevisitedAt && Date.now() - new Date(i.lastRevisitedAt).getTime() < 7 * 86400_000;
            const compound = compoundScore(i);
            return (
              <DecisionSpread
                key={i.key}
                className={cn(wasRecentlyRevisited && "ring-1 ring-amber-500/40")}
                leftLabel={
                  <span className="inline-flex items-center gap-2">
                    <span className={cn("inline-block h-1.5 w-1.5 rounded-full", SEVERITY_DOT[i.severity], wasRecentlyRevisited && "animate-pulse")} />
                    <span className="font-mono tracking-[0.2em]">{DOMAIN_CODE[i.domain]}</span>
                    <span>· attempt</span>
                  </span>
                }
                leftTitle={i.attempt || i.key}
                leftBody={i.lesson}
                leftMeta={
                  i.tags.length > 0
                    ? i.tags.slice(0, 4).map((t) => `#${t}`).join(" · ")
                    : `first tried ${timeAgo(i.firstTriedAt)}`
                }
                score={compound}
                scoreFormat={(n) => n.toFixed(1)}
                scoreLabel="compound"
                rightLabel="outcome"
                rightTitle={i.outcome || "—"}
                rightBody={
                  <div className="space-y-1.5">
                    <div className="text-[11px] tracking-wide opacity-90">{i.key}</div>
                    {i.revisitCount > 0 && (
                      <div className="text-[10px] font-mono tracking-wider opacity-80">
                        revisited {i.revisitCount}× ·{" "}
                        {i.lastRevisitedAt ? timeAgo(i.lastRevisitedAt) : "never"}
                      </div>
                    )}
                  </div>
                }
                actions={
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => revisit(i.key)}
                      className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-wider text-amber-300 hover:bg-amber-500/20 transition-colors"
                    >
                      mark revisited
                    </button>
                    <button
                      onClick={() => remove(i.key)}
                      className="rounded border border-rose-500/30 bg-rose-500/[0.06] px-3 py-1 text-[10px] uppercase tracking-wider text-rose-300/90 hover:bg-rose-500/15 transition-colors"
                    >
                      delete
                    </button>
                  </div>
                }
              />
            );
          })}
        </div>
      )}

      <p className="pt-2 text-center text-[10px] text-zinc-600">
        source: BrainMemory(anti_pattern) · grepped by future Nick tool to warn on intent match
      </p>
      {/* iOS-PWA-safe confirm mount · renders null when idle. */}
      {confirmDialog}
    </div>
  );
}
