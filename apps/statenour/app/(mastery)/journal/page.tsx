"use client";

// Phase D follow-up audit (2026-05-18 PM) · second attempt at the
// useSearchParams() prerender fix. First attempt used
// `export const dynamic = "force-dynamic"` · that does NOT take
// effect on "use client" pages (route segment config is only
// honored by Server Components per Next.js 16). Real fix: wrap
// JournalPageInner in <Suspense> from the exported outer JournalPage.
// Same pattern shipped on /tasks at the same time.

/**
 * JOURNAL — Unified thought-capture feed.
 *
 * Merges BrainDump (chat + Telegram + manual), Reflection (cron
 * engine), SituationLog (War Room), and DecisionReplay (reviewed
 * decisions) into a single chronological stream.
 *
 * Filters: source (all / dump / reflection / situation / decision)
 * and thought-type (raw / thinking / reasoning / insight / decision
 * / reflection / planning / venting).
 *
 * Each entry expands inline to show the full body, extracted
 * summary, linked topics, and — for brain dumps — the action items
 * + insights + commitments extracted during ingest.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useSearchParams } from "next/navigation";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";

// v10.0.30 — structured logger for journal-page client errors.
const log = rootLogger.withSurface("journal/page");
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { NickSidePane } from "@/components/mastery/nick-side-pane";
import { MissionBreadcrumb } from "@/components/mastery/mission-breadcrumb";
import { MasteryContextDrawer } from "@/components/mastery/mastery-context-drawer";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { ActiveFiltersStrip } from "@/components/ui/filter-chip-bar";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { cn } from "@/lib/utils";
import { onDataChanged } from "@/lib/events/data-change";
import { Calendar, NotebookPen, Search, X as XIcon } from "lucide-react";
import { ReflectComposer } from "@/components/journal/reflect-composer";
import { ThreadRadar } from "@/components/journal/thread-radar";
import { ThreadRail } from "@/components/journal/thread-rail";
import { ThreadSuggestions } from "@/components/journal/thread-suggestions";
// Wave AP · 2026-05-28 · Sam-led /journal trio · brief + prompt + strip
import { NicksJournalBrief } from "@/components/journal/nicks-journal-brief";
import { TodaysPrompt } from "@/components/journal/todays-prompt";
import { JournalThreadsStrip } from "@/components/journal/journal-threads-strip";
import { JournalInsightsPreview } from "@/components/journal/journal-insights-preview";
import {
  TYPE_META,
  type FeedEntry,
  type SourceKey,
  type TypeKey,
} from "@/components/journal/types";
import { JournalEntryRow } from "@/components/journal/entry-row";

// Phase TT (2026-05-19 AM) · authedFetch replaced by trpc · 2 reads
// (feed · metacognition) now flow through typed procedures.
import { trpc } from "@/lib/trpc/client";
// ─── Types ─────────────────────────────────────────────
// v10.0.284 · FeedEntry · SourceKey · TypeKey · TYPE_META · SOURCE_ICON
// + JournalEntryRow extracted to components/journal/{types,entry-row}.
// FeedResponse stays here · API-response shape, only the page reads it.

interface FeedResponse {
  data: {
    entries: FeedEntry[];
    counts: {
      total: number;
      bySource: Record<string, number>;
      byType: Record<string, number>;
    };
  };
}

// v10.0.529.24 · subset of the JournalEntry server-type used by the
// metacognition card. Mirrors the fields rendered below · not the
// full server interface · keeps the page from depending on
// lib/brain/learning-journal.ts at compile time.
interface MetacognitionEntry {
  date: string;
  selfAssessment: string;
  learningRate: { daily: number; weekly: number; monthly: number; trend: "accelerating" | "steady" | "decelerating" };
  predictionCalibration: { calibrationScore: number; overconfident: number; underconfident: number; wellCalibrated: number };
  weakSpots: { domain: string; daysSinceLastLearning: number; memoryCount: number }[];
  stagnationAlert: string | null;
}

// ─── Page ──────────────────────────────────────────────

// Outer · Suspense boundary required because JournalPageInner calls
// useSearchParams() (Phase D cross-link #1 · ?search= seeding).
// Per Next.js 16, useSearchParams in a client component MUST be
// wrapped in <Suspense> for static prerender to succeed.
export default function JournalPage() {
  return (
    <>
      <Suspense fallback={null}>
        <JournalPageInner />
      </Suspense>
      {/* Phase 5 FULL propagation (2026-05-26) · NickSidePane on
       *  /journal. Mounted at the page-level (outside Suspense) so the
       *  FAB renders even before the heavy journal feed hydrates ·
       *  operator can capture a thought instantly. Presets bias toward
       *  patterns / threads / blind spots. */}
      <NickSidePane
        page="journal"
        coachSurface="journal"
        presets={[
          "What pattern keeps surfacing in this week's entries?",
          "Which blind spot am I dancing around?",
          "Which thread is the real story behind today?",
          "What would I tell a younger me about this entry?",
        ]}
      />
    </>
  );
}

function JournalPageInner() {
  // Phase D follow-up audit (2026-05-18) · cross-link #1 ·
  // initialize search from ?search= URL param so deep-links from
  // ThreadRail "view in feed →" land on a pre-filtered view.
  // The state mirror keeps subsequent typing reactive · the URL
  // param is the seed, not the source of truth.
  const searchParams = useSearchParams();
  const initialSearch = searchParams?.get("search") ?? "";

  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [counts, setCounts] = useState<FeedResponse["data"]["counts"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<SourceKey>("all");
  const [type, setType] = useState<TypeKey>("all");
  const [search, setSearch] = useState(initialSearch);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // v10.0.436 · sort key · localStorage-persisted · 6 modes
  type JournalSort = "newest" | "oldest" | "alpha-asc" | "alpha-desc" | "longest" | "shortest";
  const [sortKey, setSortKey] = useState<JournalSort>(() => {
    if (typeof window === "undefined") return "newest";
    const saved = window.localStorage.getItem("journal:sortKey");
    const valid: JournalSort[] = ["newest", "oldest", "alpha-asc", "alpha-desc", "longest", "shortest"];
    return saved && valid.includes(saved as JournalSort) ? (saved as JournalSort) : "newest";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("journal:sortKey", sortKey);
  }, [sortKey]);
  // v10.0.30 — error state. Pre-v10.0.30 the load() catch silently
  // reset entries to [], so a 401 / 429 / 500 looked identical to a
  // legitimately empty filter. Now: distinct error banner + preserved
  // HTTP status code so the operator knows what happened.
  const [error, setError] = useState<string | null>(null);
  // v10.0.30 — abort signal so rapid filter changes / data-change
  // events don't pile up overlapping requests with stale resolutions.
  const inflightRef = useRef<AbortController | null>(null);
  // v10.0.30 — gate the stagger-in animation to the first load only.
  // Pre-v10.0.30 every filter change re-fired the animation cascade
  // (delay = i * 40ms), so entry 99 waited ~4s to appear after a
  // filter switch — perceived as freezing. Only animate on initial
  // mount; subsequent loads jump straight to position.
  const hasLoadedOnceRef = useRef(false);

  // v10.0.529.24 · metacognition · loads the latest learning-journal
  // entry the evening cron produces. Surfaces Nick's nightly
  // self-assessment of his brain (learningRate · calibration · weak
  // spots) right at the top of /journal so the operator can see it
  // without re-running the 16-query Promise.all the cron does. Null
  // when no cron run has landed yet or legacy rows have no metadata.
  const [meta, setMeta] = useState<MetacognitionEntry | null>(null);

  // Phase D · ADR-0013 · pattern-radar refresh signal · bumped when
  // operator confirms a convergence candidate so the ThreadRail
  // re-pulls and shows the new thread above the feed.
  const [threadRefresh, setThreadRefresh] = useState(0);

  // Phase TT · tRPC migration · imperative-fetch-via-utils inside the
  // existing load() function so the page's AbortController/inflightRef
  // scheduling stays intact. Same JJ/MM/PP pattern · pure data-source
  // swap · no UX behavior change.
  const utils = trpc.useUtils();

  const load = useCallback(async () => {
    // Abort any in-flight load so the latest filter wins on resolve.
    if (inflightRef.current) inflightRef.current.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    setLoading(true);
    try {
      const view = await utils.journal.feed.fetch({
        source: source !== "all" ? source : undefined,
        type: type !== "all" ? type : null,
        limit: 100,
        days: 60,
      });
      if (ctrl.signal.aborted) return;
      setEntries(view.entries as typeof entries);
      setCounts(view.counts as typeof counts);
      setError(null);
    } catch (err) {
      // Aborted requests are expected — don't surface as user-facing errors.
      if ((err as { name?: string })?.name === "AbortError") return;
      // v10 B.1 FIND-05 · also reset counts on error so the filter
      // badge ("3 decisions") doesn't drift from the empty feed
      // ("No thoughts captured") — contradictory state confused the
      // operator after a failed filter switch.
      setEntries([]);
      setCounts(null);
      // v10.0.529.21 · sanitize the error before surfacing to the UI.
      // Pre-fix raw Prisma/Neon error strings could leak table names
      // and column hints in the operator-facing banner. log.error
      // keeps the raw message for the /system/errors dashboard.
      const rawMsg = err instanceof Error ? err.message : String(err);
      log.error("journal_load_failed", { error: rawMsg });
      setError(sanitizeError(err));
    } finally {
      setLoading(false);
    }
  }, [source, type, utils]);

  useEffect(() => {
    load();
  }, [load]);

  // v10.0.529.24 · fetch metacognition once on mount. Fire-and-forget ·
  // failures degrade silently to "card hidden" rather than breaking the
  // feed below · this is supplemental context, not load-critical data.
  // Phase TT · migrated to utils.journal.metacognition.fetch() · same
  // mount-only fire-and-forget shape.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entry = await utils.journal.metacognition.fetch();
        if (!cancelled) setMeta(entry as MetacognitionEntry | null);
      } catch (err) {
        if (!cancelled) log.warn("metacognition_fetch_failed", { error: sanitizeError(err) });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v10.0.30 — flip the stagger gate AFTER the first render that
  // has entries. Setting it inside load() runs before the render is
  // committed, so the first stagger would be skipped. This effect
  // runs post-commit, so the initial mount staggers and every
  // subsequent load (filter switch / data-change) jumps straight.
  useEffect(() => {
    if (entries.length > 0 && !hasLoadedOnceRef.current) {
      // Defer to the next tick so the current animation can run
      // before we flip the gate for future loads.
      const t = setTimeout(() => {
        hasLoadedOnceRef.current = true;
      }, 100);
      return () => clearTimeout(t);
    }
    // No-op return so the effect's cleanup-return type is unified.
    return undefined;
  }, [entries]);

  // Cross-surface refresh — when a brain dump or decision gets
  // captured anywhere (chat NL interceptor, global capture, telegram,
  // OR chat AI tool: logSituation / journalDecision / review etc.),
  // the page auto-reloads.
  //
  // v10.0.529.87 · Wave 31 · subscribe to BOTH the targeted "journal"
  // domain AND "any" with the legacy detail-string guard. Pre-Wave-31
  // the page only matched 3 detail strings — tool-driven writes from
  // chat fell through unnoticed. Targeted domain closes the gap while
  // legacy NL interceptor paths still match on detail string.
  useEffect(() => {
    return onDataChanged(["any", "journal"], (e) => {
      // Targeted "journal" domain → always reload (tool calls land here).
      if (e.domain === "journal") {
        load();
        return;
      }
      // "any" domain → legacy NL interceptor + global capture paths
      // that pre-date the targeted domain. Filter by detail string so
      // unrelated "any" fires (e.g. score/habit writes) don't churn.
      if (
        e.detail === "journal-capture" ||
        e.detail === "nl-brain-dump" ||
        e.detail === "nl-decision"
      ) {
        load();
      }
    });
  }, [load]);

  // Deep-link: /journal#bd-<id> scrolls + highlights the target entry.
  // Used by the /tasks UI backlinks ("from journal" badge on a task).
  // Has to fire after entries load since the DOM node doesn't exist yet
  // on the first render when the feed is still fetching.
  useEffect(() => {
    if (entries.length === 0) return;
    const hash = window.location.hash || "";
    if (!hash.startsWith("#bd-")) return;
    const id = hash.slice(4);
    const el = document.getElementById(`bd-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-[var(--gold)]/60");
    // v10.0.30 — cleanup: cancel the timer on unmount or entries change
    // so we don't fire setTimeout against a node React already
    // reconciled away. Pre-v10.0.30 this could mutate a detached
    // element after navigation.
    const t = setTimeout(() => {
      el.classList.remove("ring-2", "ring-[var(--gold)]/60");
    }, 2500);
    return () => clearTimeout(t);
  }, [entries]);

  // Apply the client-side text filter before grouping. The filter
  // checks title + body + summary + linkedTopics so "cameron" finds
  // the Global Cleveland thread and "tire" finds every tire-related
  // capture. Case-insensitive substring match.
  const q = search.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!q) return entries;
    return entries.filter((e) => {
      const haystack = `${e.title} ${e.body} ${e.summary || ""} ${(e.linkedTopics || []).join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, q]);

  // v10.0.436 · sort dispatch · default = newest (date desc).
  // 6 modes mirror the wisdom + skills pattern.
  const sortedEntries = useMemo(() => {
    const out = [...filteredEntries];
    switch (sortKey) {
      case "oldest":
        out.sort((a, b) => a.date.localeCompare(b.date));
        break;
      case "alpha-asc":
        out.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "alpha-desc":
        out.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case "longest":
        out.sort((a, b) => (b.body?.length ?? 0) - (a.body?.length ?? 0));
        break;
      case "shortest":
        out.sort((a, b) => (a.body?.length ?? 0) - (b.body?.length ?? 0));
        break;
      case "newest":
      default:
        out.sort((a, b) => b.date.localeCompare(a.date));
        break;
    }
    return out;
  }, [filteredEntries, sortKey]);

  // Group filtered entries by date for the day headers.
  //
  // 2026-05-24 · Wave R · pre-fix this grouped over the already-sorted
  // list which meant `alpha-asc` / `alpha-desc` / `longest` /
  // `shortest` modes broke the day-grouping invariant · two non-
  // adjacent entries sharing a date created TWO day-group headers
  // for the same date. Day headers are always date-ordered now ·
  // entries within each day inherit whatever the sortKey dictated.
  // For date-monotonic modes (newest/oldest, which is the default)
  // this is identical to the pre-fix behavior.
  const byDate = useMemo(() => {
    const groups = new Map<string, FeedEntry[]>();
    for (const e of sortedEntries) {
      const key = e.date;
      const list = groups.get(key) || [];
      list.push(e);
      groups.set(key, list);
    }
    // Day-header sort · newest-first if the user is on a "newest"-ish
    // mode, otherwise oldest-first so the day axis matches the
    // entries axis. The entry-level sort (sortedEntries) handles the
    // within-day order.
    const dateAsc = sortKey === "oldest";
    return Array.from(groups.entries()).sort((a, b) =>
      dateAsc ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]),
    );
  }, [sortedEntries, sortKey]);

  // H.3.1 · suppress DeepModeNudge across the entire journal surface.
  // Journal entries ARE deep thinking — every brain-dump, decision-
  // replay, reflection would trigger the classifier and surface the
  // chip on every keystroke. data-no-deep-nudge on the root wrapper
  // makes the global watcher skip any focused input inside it.
  return (
    <div className="min-h-screen text-zinc-100 space-y-5" data-no-deep-nudge>
      <SectionHeader
        icon={<NotebookPen size={16} className="text-[var(--gold)]" />}
        label="Journal"
        subtitle="thinking · reasoning · insights · decisions · reflections"
        accent="gold"
        live
      />

      {/* Mastery Layer Stage D · 2026-05-26 · mission-mode breadcrumb.
       *  Self-hides when ?missionId is absent. */}
      <MissionBreadcrumb />

      {/* Mastery Layer Stage A · Coach Channel surface · 2026-05-26.
       *  Surfaces system-noticed events tagged for journal (pattern
       *  observations, thread suggestions, learning velocity nudges).
       *  Self-hides when zero events. */}
      <CoachEventBanner surface="journal" />

      {/* Wave AP · 2026-05-28 · Sam-Altman frame · 3 components ·
       *  brief (narrative anchor) → today's prompt (hero) → threads
       *  triage strip. Same pattern shipped on /goals (Wave AI) and
       *  /missions (Wave AO). Each self-hides on empty so a fresh
       *  /journal (zero entries, zero threads) stays clean. */}
      <div className="mt-4 space-y-3">
        <NicksJournalBrief />
        <TodaysPrompt />
        <JournalThreadsStrip />
        {/* Journal-advancement item D (2026-06-10) · Proof of Becoming.
            One honest evidence line — enriched entries this week grouped
            by life domain + goal-linked count. Derived from real data
            (enrichedAt + extractedItems + linkStatus) · never synthetic ·
            self-hides on a zero week. */}
        <ProofOfBecomingStrip />
        <JournalInsightsPreview />
      </div>

      {/* Mastery Layer Stage B adoption on /journal · 2026-05-26.
       *  CONSERVATIVE wrap · the two pure info-display bands (learning
       *  velocity ticker + weekly memoir) move into a collapsible
       *  drawer. The primary thread navigation (ThreadRadar / ThreadRail
       *  / ThreadSuggestions) STAYS above-fold — those are the
       *  operator's primary work surface on /journal. Same for the
       *  Reflect Composer below. The drawer is collapsed by default
       *  · self-fetching children stay dormant on cold load. */}
      <MasteryContextDrawer
        surface="journal"
        label="Reflection signals"
        hint="learning velocity · weekly memoir"
      >
        <div className="space-y-4">
          {/* 2026-05-24 · Wave S #7 · Learning-velocity ticker. Wires the
              existing measureLearningVelocity() helper (already computes
              for /brain) to a one-line surface above the feed. Silent on
              fetch failure · silent when both deltas are zero (avoids
              "0 entries · 0 new" noise on a fresh week). */}
          <LearningVelocityTicker />

          {/* 2026-05-24 · Wave S #5 · Weekly memoir block. Surfaces the
              last 7 days of distilled wisdom / belief promotions from the
              existing wisdom-distiller cron · top 3 only · silent when
              fewer than 2 items (operator doesn't need a memoir of zero). */}
          <WeeklyMemoirBlock />
        </div>
      </MasteryContextDrawer>

      {/* Phase D · ADR-0013 · pattern-radar
          ThreadRadar shows convergence candidates the nightly cron
          detected · silent when none. ThreadRail shows pinned active
          (and dormant) threads · silent when none. Both sit ABOVE the
          metacognition card so emerging-theme signals get priority
          over nightly self-assessment. */}
      <ThreadRadar onThreadCreated={() => setThreadRefresh((n) => n + 1)} />
      <ThreadRail refreshSignal={threadRefresh} />
      <ThreadSuggestions
        refreshSignal={threadRefresh}
        onActioned={() => setThreadRefresh((n) => n + 1)}
      />

      {/* 2026-05-24 · Wave S #3 + #6 · Brain signals chip · overall
          emotional trajectory + drift composite. Pulls from
          analyzeEmotionalArc + computeDriftScore via one combined
          procedure. Renders as a slim row · silent when both helpers
          fail or both signals are dormant. Sits above the
          metacognition card because it's a "right now" pulse and the
          metacognition card is "last night's verdict." */}
      <BrainSignalsChip />

      {/* v10.0.529.24 · METACOGNITION CARD — Nick's nightly self-
          assessment of his own brain, computed by the evening cron and
          persisted as JournalEntry metadata. Surfaces learningRate +
          trend + calibrationScore + weakSpots so the operator can see
          how the brain is doing WITHOUT re-running the 16-query cron.
          Hidden when no cron run has landed yet (meta === null). */}
      {meta && (
        <div className="rounded-xl border border-[var(--gold)]/20 bg-gradient-to-br from-[var(--gold)]/[0.04] to-transparent p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--gold)]/80">
                Metacognition
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)]">
                · {meta.date}
              </span>
            </div>
            <span
              className={cn(
                "text-[10px] font-medium tabular-nums",
                meta.learningRate.trend === "accelerating" && "text-emerald-400",
                meta.learningRate.trend === "steady" && "text-[var(--text-secondary)]",
                meta.learningRate.trend === "decelerating" && "text-amber-400",
              )}
            >
              {meta.learningRate.trend}
            </span>
          </div>

          {meta.selfAssessment && (
            <p className="text-[12.5px] leading-relaxed text-[var(--text-primary)] italic">
              &ldquo;{meta.selfAssessment}&rdquo;
            </p>
          )}

          {/* v10.0.529.57 · daily/weekly/monthly counter grid CUT
              (audit Wave 9 · MED-confidence dead weight). The trend
              label above already conveys direction · raw counts the
              operator never interrogated. Calibration score collapsed
              into the trend chip below to preserve the signal. */}
          <div className="flex items-center gap-3 pt-1 text-[11px] font-mono text-[var(--text-secondary)]">
            <span className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              calibration
            </span>
            <span className="text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">
              {Math.round(meta.predictionCalibration.calibrationScore * 100)}%
            </span>
          </div>

          {/* Weak-spot row · top 2 by daysSinceLastLearning so the
              operator sees the most-stale domains. Only renders when
              the cron flagged at least one weak spot · the array
              upstream is already sorted desc by staleness.
              2026-05-24 · Wave R · add "+N more" indicator when the
              truncation hides additional weak spots · pre-fix a
              brain with 7 weak spots looked identical to a brain
              with 2 (false sense of health · Nielsen #1 violation). */}
          {meta.weakSpots.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--text-tertiary)] mr-1">
                Weak spots
              </span>
              {meta.weakSpots.slice(0, 2).map((spot) => (
                <Badge
                  key={spot.domain}
                  variant="outline"
                  className="text-[10px] border-amber-400/30 text-amber-300 bg-amber-400/[0.04]"
                >
                  {spot.domain} · {spot.daysSinceLastLearning}d stale
                </Badge>
              ))}
              {meta.weakSpots.length > 2 && (
                <span
                  className="text-[10px] font-mono text-amber-400/60"
                  title={meta.weakSpots
                    .slice(2)
                    .map((s) => `${s.domain} (${s.daysSinceLastLearning}d)`)
                    .join(" · ")}
                >
                  +{meta.weakSpots.length - 2} more
                </span>
              )}
            </div>
          )}

          {/* Stagnation alert · the cron emits a non-null string when
              the brain has plateaued · always renders red so it can't
              be missed visually in the sea of gold. */}
          {meta.stagnationAlert && (
            <div className="text-[11.5px] leading-relaxed text-red-300 border-l-2 border-red-400/40 pl-3 mt-2">
              {meta.stagnationAlert}
            </div>
          )}
        </div>
      )}

      {/* Reflect composer — primary structured-entry surface. Sits above
          the feed so a new reflection is always 4 fields away. Supports
          SOAP, Driscoll, Stop/Start/Continue, and After-Action Review. */}
      <ReflectComposer />

      {/* ── Search box — filters the loaded feed on the client so it
          composes with the server-side Source and Type filters. Stays
          focused on title + body + summary + linkedTopics so it feels
          like a real search, not just a title match.
          v10.0.436 · added sort dropdown alongside · 6 modes ── */}
      <div className="flex gap-2 flex-wrap sm:flex-nowrap">
        <div className="relative flex-1 min-w-0">
          <Search
            size={12}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
          />
          <input
            type="text"
            placeholder="Search journal — titles, body, summary, tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-2 min-h-[44px] sm:min-h-0 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--gold)]/40 transition-colors"
          />
          {search.length > 0 && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
              aria-label="Clear search"
            >
              <XIcon size={12} />
            </button>
          )}
        </div>
        <SortDropdown<JournalSort>
          value={sortKey}
          onChange={setSortKey}
          defaultValue="newest"
          ariaLabel="Sort journal entries"
          options={[
            { value: "newest", label: "newest first" },
            { value: "oldest", label: "oldest first" },
            { value: "alpha-asc", label: "title · A→Z" },
            { value: "alpha-desc", label: "title · Z→A" },
            { value: "longest", label: "body · longest" },
            { value: "shortest", label: "body · shortest" },
          ]}
        />
      </div>
      <ActiveFiltersStrip
        filters={[
          ...(search.trim() ? [{ label: `search · "${search.trim().slice(0, 20)}"`, onRemove: () => setSearch("") }] : []),
          ...(source !== "all" ? [{ label: `source · ${source}`, onRemove: () => setSource("all") }] : []),
          ...(type !== "all" ? [{ label: `type · ${type}`, onRemove: () => setType("all") }] : []),
          ...(sortKey !== "newest" ? [{ label: `sort · ${sortKey}`, onRemove: () => setSortKey("newest") }] : []),
        ]}
        onClearAll={() => { setSearch(""); setSource("all"); setType("all"); setSortKey("newest"); }}
      />

      {/* ── Source filter row ── */}
      <FilterChipRow<SourceKey>
        label="Source"
        keys={["all", "dump", "reflection", "situation", "decision", "retro"] as const}
        active={source}
        onChange={setSource}
        counts={
          counts
            ? {
                all: counts.total,
                dump: counts.bySource.dump ?? 0,
                reflection: counts.bySource.reflection ?? 0,
                situation: counts.bySource.situation ?? 0,
                decision: counts.bySource.decision ?? 0,
                retro: counts.bySource.retro ?? 0,
              }
            : undefined
        }
        chipSize="md"
        ariaLabelSuffix="filter"
        emptyLabel="entries"
      />

      {/* ── Type filter row (only relevant for brain dumps) ── */}
      <FilterChipRow<TypeKey>
        label="Type"
        keys={["all", "raw", "thinking", "reasoning", "insight", "decision", "reflection", "planning", "venting"] as const}
        active={type}
        onChange={setType}
        counts={
          counts
            ? {
                all: counts.total,
                raw: counts.byType.raw ?? 0,
                thinking: counts.byType.thinking ?? 0,
                reasoning: counts.byType.reasoning ?? 0,
                insight: counts.byType.insight ?? 0,
                decision: counts.byType.decision ?? 0,
                reflection: counts.byType.reflection ?? 0,
                planning: counts.byType.planning ?? 0,
                venting: counts.byType.venting ?? 0,
              }
            : undefined
        }
        getMeta={(key) => (key === "all" ? null : TYPE_META[key as Exclude<TypeKey, "all">])}
        chipSize="sm"
        ariaLabelSuffix="type filter"
        emptyLabel="entries"
        hideZeroCount
      />

      {/* v10.0.30 — error banner. Pre-v10.0.30 a 401 / 429 / 500
          fell silently into "No thoughts captured" — operator
          couldn't tell load failure from empty filter. */}
      {error && (
        <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.05] px-3 py-2 text-[12px] text-rose-200 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px]">{error}</span>
          <button
            onClick={() => {
              setError(null);
              load();
            }}
            className="rounded border border-rose-500/40 px-2 py-1 text-[10px] hover:bg-rose-500/10"
          >
            retry
          </button>
        </div>
      )}

      {/* ── Feed ── */}
      {loading && entries.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <ShimmerSkeleton key={i} className="h-20 rounded-xl border border-zinc-800/40" />
          ))}
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-[var(--gold)]/20 bg-gradient-to-b from-[var(--gold)]/5 to-zinc-900/40">
          <NotebookPen size={24} className="text-[var(--gold)]/60 mx-auto mb-3" />
          {q ? (
            <>
              <p className="text-[13px] font-semibold text-[var(--text-secondary)]">
                No matches for &ldquo;{search}&rdquo;.
              </p>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-2 max-w-[380px] mx-auto">
                {entries.length} entries loaded. Try different keywords, or{" "}
                <button
                  onClick={() => setSearch("")}
                  className="text-[var(--gold)] hover:underline"
                >
                  clear search
                </button>
                .
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] font-semibold text-[var(--text-secondary)]">
                No thoughts captured yet in this filter.
              </p>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-2 max-w-[380px] mx-auto">
                Use <kbd className="font-mono text-[10px] px-1 rounded bg-zinc-800/80 border border-zinc-700/50">⌘⇧J</kbd> to capture anywhere, open{" "}
                <span className="text-[var(--gold)]">/chat?mode=flow</span> for a guided dump, or send a Telegram message.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {byDate.map(([date, dayEntries]) => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-2">
                <Calendar size={11} className="text-[var(--text-tertiary)]" />
                <span className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
                  {formatDay(date)}
                </span>
                <div className="h-px flex-1 bg-zinc-800/50" />
                <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
                  {dayEntries.length} {dayEntries.length === 1 ? "entry" : "entries"}
                </span>
              </div>
              <div className="space-y-1.5">
                {dayEntries.map((entry, i) => (
                  <JournalEntryRow
                    key={entry.id}
                    entry={entry}
                    isExpanded={expandedId === entry.id}
                    onToggle={() =>
                      setExpandedId((curr) => (curr === entry.id ? null : entry.id))
                    }
                    /* v10.0.30 — stagger only on first load; filter
                       changes jump straight in (no 4s cascade). */
                    delay={hasLoadedOnceRef.current ? 0 : i * 40}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDay(dateStr: string): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const y = yesterday.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  if (dateStr === today) return "Today";
  if (dateStr === y) return "Yesterday";
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

// ─── FilterChipRow ────────────────────────────────────────────────
// v10.0.530 kaizen · the source-row and type-row of /journal had
// near-identical structure: flex-wrap of aria-pressed toggle buttons
// with an inline AnimatedCounter. Wave-8 audit flagged the
// duplication. Extracted as a local generic primitive (file-local
// per uncle-bob single-responsibility — only 2 callers, both here,
// no need to expose at module boundary).
type ChipMeta = {
  icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  bg?: string;
  border?: string;
  color?: string;
} | null;

interface FilterChipRowProps<K extends string> {
  label: string;
  keys: readonly K[];
  active: K;
  onChange: (key: K) => void;
  counts?: Record<K, number>;
  /** Per-key visual metadata · returns null for "all" / unmapped keys. */
  getMeta?: (key: K) => ChipMeta;
  chipSize?: "sm" | "md";
  /** Suffix in the aria-label · e.g. "filter" → "dump filter, 3 entries". */
  ariaLabelSuffix?: string;
  /** Unit noun for the aria-label count · default "entries". */
  emptyLabel?: string;
  /** When true, hide the count badge if count === 0 (type-row behaviour). */
  hideZeroCount?: boolean;
}

function FilterChipRow<K extends string>({
  label,
  keys,
  active,
  onChange,
  counts,
  getMeta,
  chipSize = "md",
  ariaLabelSuffix = "filter",
  emptyLabel = "entries",
  hideZeroCount = false,
}: FilterChipRowProps<K>) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--text-tertiary)] mr-1">
        {label}
      </span>
      {keys.map((key) => {
        const isActive = active === key;
        const meta = getMeta?.(key) ?? null;
        const Icon = meta?.icon;
        const count = counts ? counts[key] ?? 0 : null;
        const showCount = count !== null && (!hideZeroCount || count > 0);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            // v10.0.529.21 a11y · aria-pressed lets screen readers
            // announce the active filter state on this toggle-style
            // chip. Visual gold border alone is insufficient signal.
            aria-pressed={isActive}
            aria-label={count !== null ? `${key} ${ariaLabelSuffix}, ${count} ${emptyLabel}` : String(key)}
            className={cn(
              "flex items-center gap-1 rounded-md font-bold uppercase tracking-wider border transition-all",
              chipSize === "md" ? "px-2.5 py-1 text-[10px]" : "px-2 py-1 text-[9px]",
              // 2026-05-24 · Wave R · iOS HIG 44pt tap target via
              // pointer-coarse media query · the chip's visual height
              // stays the same on desktop (mouse) but expands to 44px
              // on touch devices. Pre-fix the chips were ~20-24px tall ·
              // operator on iPhone had to thumb a 4-line-tall area to
              // reliably hit one. Tailwind v4 arbitrary variant syntax.
              "[@media(pointer:coarse)]:min-h-[44px]",
              isActive
                ? meta
                  ? `${meta.bg} ${meta.border} ${meta.color}`
                  : "bg-[var(--gold)]/15 border-[var(--gold)]/40 text-[var(--gold)]"
                : meta
                ? "bg-transparent border-transparent text-zinc-600 hover:text-zinc-400"
                : "bg-transparent border-zinc-800 text-zinc-500 hover:text-zinc-300"
            )}
          >
            {Icon && <Icon size={9} aria-hidden />}
            {key}
            {showCount && (
              // 2026-05-24 · Wave R · pre-fix every chip count animated
              // via <AnimatedCounter> · with 14 chips visible the whole
              // row ticked from 0 simultaneously on every page load /
              // re-fetch · classic "gpt-built" gratuitous motion. Plain
              // span is the editorial-minimalist choice · matches the
              // chip-count rendering on /settings + /tasks.
              <span className="text-[8px] font-mono opacity-70 tabular-nums" aria-hidden>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Wave S · feature-mining wire-ups · 2026-05-24
// ═══════════════════════════════════════════════════════════════════════
//
// Two inline components consuming the new journal-router procedures.
// Both are silent-by-default per kaizen · only render when there's
// signal worth surfacing. Extracted from the page body so the main
// component stays scannable.

/**
 * Wave S #7 · Learning-velocity ticker.
 *
 * Single line above the feed · gives the operator at-a-glance whether
 * the week is generative or just busy. Reads measureLearningVelocity
 * via tRPC · returns null on fetch failure or zero-signal week.
 */
function LearningVelocityTicker() {
  const { data } = trpc.journal.learningVelocity.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  if (!data) return null;
  // Silent when truly nothing happened this week · "0 entries · 0 new"
  // would just be noise. Threshold is intentionally low (any of the
  // three counters non-zero qualifies).
  const hasSignal =
    data.memoriesThisWeek > 0 ||
    data.newConnections > 0 ||
    data.contradictionsResolved > 0 ||
    data.wisdomPromotions > 0;
  if (!hasSignal) return null;
  const deltaSign = data.memoriesDelta > 0 ? "+" : "";
  return (
    <div className="flex items-center gap-3 text-[10px] font-mono text-[var(--text-tertiary)] py-1">
      <span className="font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        velocity
      </span>
      <span className="tabular-nums">
        {data.memoriesThisWeek} entries this week
        {data.memoriesDelta !== 0 && (
          <span
            className={cn(
              "ml-1",
              data.memoriesDelta > 0 ? "text-emerald-400/80" : "text-rose-400/70",
            )}
          >
            ({deltaSign}{data.memoriesDelta} vs last)
          </span>
        )}
      </span>
      {data.newConnections > 0 && (
        <span className="tabular-nums">· {data.newConnections} new connections</span>
      )}
      {data.contradictionsResolved > 0 && (
        <span className="tabular-nums">· {data.contradictionsResolved} contradictions resolved</span>
      )}
      {data.wisdomPromotions > 0 && (
        <span className="tabular-nums">· {data.wisdomPromotions} wisdom</span>
      )}
      <span className="ml-auto text-[var(--text-tertiary)]/60">
        brain {data.healthScore}/100
      </span>
    </div>
  );
}

/**
 * Wave S #3 + #6 · Brain signals chip.
 *
 * Slim row showing the operator's emotional trajectory + drift
 * composite. Covers two feature-mining candidates with one read.
 * Silent when both signals are dormant.
 */
function BrainSignalsChip() {
  const { data } = trpc.journal.brainSignals.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  if (!data) return null;
  const { emotionalArc: arc, drift } = data;
  if (!arc && !drift) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-void)]/40 px-3 py-2 text-[10px]">
      <span className="font-bold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
        right now
      </span>
      {arc && (
        <>
          <span className="font-mono">
            <span className="text-[var(--text-tertiary)]">trajectory ·</span>{" "}
            <span
              className={cn(
                "font-medium",
                arc.trajectory === "rising" && "text-emerald-300",
                arc.trajectory === "falling" && "text-rose-300",
                arc.trajectory === "volatile" && "text-amber-300",
                arc.trajectory === "stable" && "text-[var(--text-secondary)]",
              )}
            >
              {arc.trajectory}
            </span>
          </span>
          {arc.dominantState && (
            <span className="font-mono text-[var(--text-secondary)]">
              · {arc.dominantState.toLowerCase()}
            </span>
          )}
          {arc.stressDays > 0 && (
            <span className="font-mono text-amber-400/70">
              · {arc.stressDays} stress day{arc.stressDays === 1 ? "" : "s"}/7
            </span>
          )}
        </>
      )}
      {drift && (
        <>
          <span className="font-mono">
            <span className="text-[var(--text-tertiary)]">drift ·</span>{" "}
            <span
              className={cn(
                "font-medium tabular-nums",
                drift.overallScore < 3 && "text-emerald-300",
                drift.overallScore >= 3 && drift.overallScore < 6 && "text-amber-300",
                drift.overallScore >= 6 && "text-rose-300",
              )}
            >
              {drift.overallScore.toFixed(1)}/10
            </span>
          </span>
          {drift.topConcern && (
            <span
              className="font-mono text-[var(--text-secondary)] truncate max-w-[200px]"
              title={drift.topConcern}
            >
              · {drift.topConcern}
            </span>
          )}
        </>
      )}
      {arc?.intervention && (
        <span
          className="ml-auto truncate max-w-[280px] text-[var(--gold)]/70 italic"
          title={arc.intervention}
        >
          → {arc.intervention.slice(0, 60)}
        </span>
      )}
    </div>
  );
}

/**
 * Journal-advancement item D (2026-06-10) · Proof of Becoming strip.
 *
 * The operator's evidence file, one line: how many entries the brain
 * decoded this week (vs last), how many landed on a goal, and which
 * life domains they prove. Every number is derived from real rows
 * (enrichedAt / linkStatus / extracted domains) — blank beats
 * fabricated, so a zero week renders nothing.
 */
function ProofOfBecomingStrip() {
  const { data } = trpc.journal.proofStack.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  if (!data || data.weekTotal === 0) return null;
  const delta = data.weekTotal - data.prevWeekTotal;
  const filed = data.becomingDomains.filter((d) => d.count > 0).length;
  return (
    <section
      className="rounded-lg border border-[var(--gold)]/20 bg-[var(--gold)]/[0.03] px-3 py-2.5 space-y-2.5"
      aria-label="This week's proof stack — your evidence file"
    >
      {/* Trend header — kept from the original strip: total this week vs
          last, plus goal-linked count. Every number is from real rows. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        <span className="font-bold uppercase tracking-[0.22em] text-[var(--gold)]/80">
          becoming
        </span>
        <span className="font-mono tabular-nums text-[var(--text-primary)]">
          {data.weekTotal} proof{data.weekTotal === 1 ? "" : "s"} this week
          {delta !== 0 && (
            <span className={cn("ml-1", delta > 0 ? "text-emerald-400/80" : "text-rose-400/70")}>
              ({delta > 0 ? "+" : ""}
              {delta} vs last)
            </span>
          )}
        </span>
        {data.grounded > 0 && (
          <span className="font-mono tabular-nums text-emerald-300/80">
            · {data.grounded} goal-linked
          </span>
        )}
        <span className="ml-auto font-mono tabular-nums text-[var(--text-tertiary)]">
          {filed}/{data.becomingDomains.length} domains
        </span>
      </div>

      {/* 10-domain identity grid — the operator's evidence file. Filed
          domains read as exhibits (gold count); empty domains stay visible
          and honest ("no proof logged"), never hidden. */}
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
        {data.becomingDomains.map((d) => {
          const hasProof = d.count > 0;
          return (
            <li
              key={d.key}
              className={cn(
                "flex flex-col gap-0.5 rounded-md border px-2.5 py-2 [@media(pointer:coarse)]:min-h-[44px]",
                hasProof
                  ? "border-[var(--gold)]/35 bg-[var(--gold)]/[0.06]"
                  : "border-[var(--border-default)] bg-[var(--bg-raised)]/60",
              )}
              title={
                hasProof
                  ? `${d.count} entr${d.count === 1 ? "y" : "ies"} of ${d.label.toLowerCase()} proof this week`
                  : `No ${d.label.toLowerCase()} proof logged this week`
              }
            >
              <span
                className={cn(
                  "text-[8.5px] font-bold uppercase tracking-[0.16em] leading-tight",
                  hasProof ? "text-[var(--gold)]/85" : "text-[var(--text-tertiary)]",
                )}
              >
                {d.label}
              </span>
              {hasProof ? (
                <span className="font-[var(--font-display)] text-[17px] font-bold tabular-nums leading-none text-[var(--text-primary)]">
                  {d.count}
                  <span className="ml-1 text-[8.5px] font-mono font-normal uppercase tracking-wider text-[var(--text-tertiary)]">
                    {d.count === 1 ? "entry" : "entries"}
                  </span>
                </span>
              ) : (
                <span className="text-[9px] font-mono italic leading-tight text-[var(--text-tertiary)]/70">
                  no proof logged
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Wave S #5 · Weekly memoir block.
 *
 * Top 3 distilled wisdom / belief items from the last 7 days. The
 * nightly wisdom-distiller already produces these · this surface just
 * makes them visible without going to /brain. Silent when fewer than
 * 2 items (a 1-item "memoir" is just a row, not a memoir).
 */
function WeeklyMemoirBlock() {
  const { data } = trpc.journal.weeklyMemoirItems.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30 * 60 * 1000,
  });
  if (!data || data.length < 2) return null;
  return (
    <div className="rounded-xl border border-[var(--gold)]/15 bg-[var(--gold)]/[0.02] p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--gold)]/70">
          this week
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)]">
          · distilled from your last 7 days
        </span>
      </div>
      <ul className="space-y-1">
        {data.map((item) => (
          <li
            key={item.id}
            className="text-[11.5px] leading-relaxed text-[var(--text-primary)]"
          >
            <span className="text-[var(--gold)]/40 mr-1.5">·</span>
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
