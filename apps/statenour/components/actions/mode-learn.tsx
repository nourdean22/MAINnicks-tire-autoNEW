"use client";

/**
 * KommandoLearn — Learn mode. Rebuilt Apr 15.
 *
 * The old version had a TEACH/RESEARCH toggle that forced a decision
 * before typing, generic depth pills, and an empty page with one
 * "recent" chip. Nour called it "dumb and generic."
 *
 * New version:
 *
 *   · ONE smart input — Nick decides whether to teach or research
 *     based on the query. "What are tire markups" → research.
 *     "Teach me about hiring" → teach. No toggle needed.
 *
 *   · SUGGESTED TOPICS — pulled from active goals + loops so the
 *     page is never empty. Tappable one-shot queries.
 *
 *   · LEARNING STATS — how many topics explored, insights saved.
 *     Shows the compound effect of coming to this tab.
 *
 *   · INTERACTIVE RESPONSES — key concepts as expandable cards,
 *     "try today" as a big spawn button, citations as chips.
 *
 *   · SMART ROUTING — queries that start with "research", "look up",
 *     "what is the current", etc route to the web research endpoint.
 *     Everything else goes to teach. Auto-detected, no user choice.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import {
  BookOpen,
  Globe,
  Loader2,
  Sparkles,
  ExternalLink,
  Lightbulb,
  AlertTriangle,
  Zap,
  Plus,
  Brain,
  ArrowRight,
  Clock,
} from "lucide-react";

// ── Types ──

interface TeachResponse {
  topic: string;
  title?: string;
  overview?: string;
  keyConcepts?: string[];
  mvuRead?: string;
  rulesOfThumb?: string[];
  commonMistakes?: string[];
  tryToday?: string;
  resources?: Array<{ title: string; url?: string; note?: string }>;
  nextQuestions?: string[];
  learningPath?: Array<{ topic: string; why: string }>;
}

interface ResearchResponse {
  query: string;
  content?: string;
  provider?: string;
  model?: string;
  citations?: string[];
}

type LearnTool = "teach" | "research";

const STORAGE_KEY = "nour:kommando:learn-history";
const MAX_HISTORY = 8;

interface HistoryEntry {
  tool: LearnTool;
  query: string;
  at: number;
  data: TeachResponse | ResearchResponse;
}

function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: HistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {}
}

// ── Smart routing: detect if query is research vs teach ──
// Research signals: "current", "price", "trend", "market", "data",
// "news", "compare", "look up", "research", "how much", "statistics"
const RESEARCH_SIGNALS = /\b(research|look\s*up|current|price|trend|market|data|news|compar|statistic|how\s*much|what\s*is\s*the\s*(current|latest|average)|cost\s*of|demand\s*for)\b/i;

function detectTool(query: string): LearnTool {
  if (RESEARCH_SIGNALS.test(query)) return "research";
  return "teach";
}

// ── Suggested topics based on common domains ──
// These rotate based on what Nour might be working on. In a future
// version they'll pull from active goals/loops dynamically.
const SUGGESTED_TOPICS: Array<{
  query: string;
  tool: LearnTool;
  category: string;
}> = [
  { query: "Hiring and managing shop employees", tool: "teach", category: "business" },
  { query: "Customer retention strategies for auto shops", tool: "teach", category: "business" },
  { query: "Current EV tire demand trends 2026", tool: "research", category: "market" },
  { query: "How to read a P&L statement", tool: "teach", category: "finance" },
  { query: "Negotiation tactics for supplier deals", tool: "teach", category: "strategy" },
  { query: "Average brake job markup in the US", tool: "research", category: "market" },
  { query: "Building discipline and consistency", tool: "teach", category: "personal" },
  { query: "SEO basics for local businesses", tool: "teach", category: "marketing" },
];

// ── Component ──

interface KommandoLearnProps {
  onJumpMode?: (mode: string) => void;
}

export function KommandoLearn({ onJumpMode }: KommandoLearnProps = {}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [active, setActive] = useState<HistoryEntry | null>(null);
  const [spawning, setSpawning] = useState(false);
  // task.create replaces POST /api/tasks for the "spawn a loop"
  // affordance · same `createTaskFromAPI` service the REST route calls.
  // actions-surface slice · the brain + AI calls (teach · research ·
  // memories) are now tRPC too:
  //   · ai.teach           — POST /api/ai/teach
  //   · ai.research        — POST /api/integrations/research
  //   · brain.recordMemory — POST /api/brain/memories
  //   · brain.forgetMemoryByKey — the spaced-review "Got it ✓" delete
  const createTask = trpc.task.create.useMutation();
  const teachMut = trpc.ai.teach.useMutation();
  const researchMut = trpc.ai.research.useMutation();
  const recordMemoryMut = trpc.brain.recordMemory.useMutation();
  const forgetMemoryMut = trpc.brain.forgetMemoryByKey.useMutation();
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // v10.0.529.84 · Wave 28 · A2 · goal-driven topic seeds. The top 4
  // active goals become the first 4 chips · the static SUGGESTED_TOPICS
  // set fills the remainder.
  //
  // actions-surface slice · migrated off the plain `fetch("/api/goals")`
  // onto `trpc.task.goals` (the same procedure the sibling KommandoPlan
  // tab already uses). A transport error leaves `goalSeeds` empty — the
  // static SUGGESTED_TOPICS still surface as fallback.
  const goalsQuery = trpc.task.goals.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const goalSeeds = useMemo<
    Array<{ query: string; tool: LearnTool; category: string }>
  >(
    () =>
      (goalsQuery.data?.goals ?? [])
        .filter((g) => g.status === "active" && g.title)
        .slice(0, 4)
        .map((g) => ({
          query: `How do I move ${g.title}`,
          tool: "teach" as LearnTool,
          category: g.domain ?? "personal",
        })),
    [goalsQuery.data],
  );

  // Detect what Nick will do with this query — shown as a hint
  const detectedTool = useMemo(
    () => (query.trim().length >= 3 ? detectTool(query) : null),
    [query]
  );

  const spawnLoop = useCallback(
    async (title: string) => {
      if (!title.trim()) return;
      setSpawning(true);
      try {
        await createTask.mutateAsync({
          title: title.trim(),
          loopKind: "ONCE",
          nextPhysicalAction: title.trim(),
          effort: "M15",
          roiScore: 50,
          frictionScore: 30,
          energyRequired: "MEDIUM",
          context: "ANYWHERE",
        });
        toast.success("Loop spawned → NOW");
        if (onJumpMode) onJumpMode("NOW");
      } catch {
        toast.error("Spawn failed");
      }
      setSpawning(false);
    },
    [onJumpMode, createTask]
  );

  // actions-surface slice · "Save to brain" via trpc.brain.recordMemory.
  // The legacy POST sent NO `key`, but the /api/brain/memories route
  // requires one (`!body.key` → 400) — so this affordance was
  // pre-broken: the toast said "Saved" while the write always 400'd.
  // The typed procedure requires a key, so we derive a stable one from
  // the topic + a timestamp · the save now genuinely lands. (The legacy
  // body's `confidence: 0.8` was also dead — the POST handler never
  // read it; `brainMemory.remember` seeds confidence 0.5.)
  const saveToBrain = useCallback(
    async (topic: string, content: string) => {
      try {
        const slug = topic.slice(0, 60).replace(/\s+/g, "_").toLowerCase();
        await recordMemoryMut.mutateAsync({
          category: "insight",
          key: `learn_${slug}_${Date.now()}`,
          content: `[Learn: ${topic}] ${content}`,
          source: "learn_mode",
        });
        toast.success("Saved to brain");
      } catch {
        toast.error("Save failed");
      }
    },
    [recordMemoryMut],
  );

  // ── Spaced repetition: schedule review reminders ──
  // When Nour learns something, schedule reviews at Day 1, 3, 7, 30.
  // Uses BrainMemory with category "spaced_review" and a future
  // timestamp so we can query for due reviews.
  // actions-surface slice · spaced-review scheduling via
  // trpc.brain.recordMemory (replaces the per-interval POST
  // /api/brain/memories). Each interval is upserted by its `key`.
  const scheduleSpacedReview = useCallback(
    async (topic: string, mvuSummary: string) => {
      const intervals = [1, 3, 7, 30]; // days
      for (const days of intervals) {
        const reviewDate = new Date(Date.now() + days * 86_400_000);
        try {
          await recordMemoryMut.mutateAsync({
            category: "spaced_review",
            key: `review_${topic.slice(0, 40).replace(/\s+/g, "_")}_d${days}`,
            content: JSON.stringify({
              topic,
              summary: mvuSummary.slice(0, 300),
              reviewAt: reviewDate.toISOString(),
              interval: days,
              completed: false,
            }),
            source: "learn_mode",
          });
        } catch {}
      }
    },
    [recordMemoryMut],
  );

  // ── Decision journal integration ──
  // Surface active decisions that could benefit from learning.
  // Connects "you're deciding on X" with "learn about Y."
  // actions-surface slice · "learn before you decide" · migrated off
  // `authedFetch("/api/decisions")` onto `trpc.operator.decisions`. The
  // procedure returns `{ decisions }` directly — the top 3 become
  // decision-linked learning prompts.
  const decisionsQuery = trpc.operator.decisions.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const activeDecisions = useMemo<Array<{ title: string; topic: string }>>(
    () =>
      (decisionsQuery.data?.decisions ?? [])
        .slice(0, 3)
        .map((dec) => ({
          title: dec.title,
          topic: `How to make better decisions about: ${dec.title}`,
        })),
    [decisionsQuery.data],
  );

  // Load due spaced reviews · migrated off `authedFetch("/api/brain/
  // memories?category=spaced_review")` onto `trpc.brain.memories`. The
  // "Got it ✓" button removes a row locally (dismissedReviewKeys) AND
  // fires the real soft-delete, so the due list is derived from the
  // query data minus the dismissed set.
  const [dismissedReviewKeys, setDismissedReviewKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const reviewMemoriesQuery = trpc.brain.memories.useQuery(
    { category: "spaced_review", limit: 50 },
    { retry: false, refetchOnWindowFocus: false },
  );
  const dueReviews = useMemo<
    Array<{ topic: string; summary: string; interval: number; key: string }>
  >(() => {
    const now = Date.now();
    const due: Array<{
      topic: string;
      summary: string;
      interval: number;
      key: string;
    }> = [];
    for (const m of reviewMemoriesQuery.data?.memories ?? []) {
      if (dismissedReviewKeys.has(m.key)) continue;
      try {
        const data = JSON.parse(m.content) as {
          topic: string;
          summary: string;
          interval: number;
          reviewAt: string;
          completed?: boolean;
        };
        if (data.completed) continue;
        if (new Date(data.reviewAt).getTime() <= now) {
          due.push({
            topic: data.topic,
            summary: data.summary,
            interval: data.interval,
            key: m.key,
          });
        }
      } catch {}
    }
    return due;
  }, [reviewMemoriesQuery.data, dismissedReviewKeys]);

  // Mark a spaced review as completed · hide it locally + soft-delete
  // the row. Replaces the legacy `DELETE /api/brain/memories?key=…`
  // call, which had no route handler (it always 404'd · the row was
  // never actually removed). `brain.forgetMemoryByKey` does the real
  // lookup-by-key soft-delete.
  const completeReview = useCallback(
    async (key: string) => {
      setDismissedReviewKeys((prev) => new Set(prev).add(key));
      try {
        await forgetMemoryMut.mutateAsync({ key });
      } catch {}
    },
    [forgetMemoryMut],
  );

  const [focusReviewMode, setFocusReviewMode] = useState(false);
  const [activeReviewIdx, setActiveReviewIdx] = useState(0);
  const [reviewTimeLeft, setReviewTimeLeft] = useState(45);
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (focusReviewMode && reviewTimeLeft > 0) {
      interval = setInterval(() => {
        setReviewTimeLeft((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [focusReviewMode, reviewTimeLeft]);

  const currentReviewCard = useMemo(() => {
    if (dueReviews.length === 0) return null;
    const idx = activeReviewIdx % dueReviews.length;
    return dueReviews[idx] || dueReviews[0];
  }, [dueReviews, activeReviewIdx]);

  const handleCompleteActiveReview = useCallback(async (key: string) => {
    await completeReview(key);
    if (dueReviews.length <= 1) {
      setFocusReviewMode(false);
      toast.success("All due reviews completed! Keep learning.");
    } else {
      setReviewTimeLeft(45);
      setShowSummary(false);
      setActiveReviewIdx((prev) => {
        const nextLen = dueReviews.length - 1;
        return prev >= nextLen ? 0 : prev;
      });
    }
  }, [dueReviews, completeReview]);

  const handleSkipActiveReview = useCallback(() => {
    if (dueReviews.length <= 1) {
      setFocusReviewMode(false);
    } else {
      setReviewTimeLeft(45);
      setShowSummary(false);
      setActiveReviewIdx((prev) => (prev + 1) % dueReviews.length);
    }
  }, [dueReviews]);

  const run = useCallback(
    async (overrideQuery?: string, overrideTool?: LearnTool) => {
      const q = (overrideQuery || query).trim();
      if (!q) return;
      const tool = overrideTool || detectTool(q);
      setLoading(true);
      try {
        if (tool === "teach") {
          // actions-surface slice · POST /api/ai/teach → trpc.ai.teach.
          // mutateAsync rejects on a server error · the catch below
          // surfaces the same retry-prompt toast the `!r.ok` branch did.
          const data = (await teachMut.mutateAsync({
            topic: q,
            depth: "standard",
          })) as TeachResponse;
          const entry: HistoryEntry = { tool: "teach", query: q, at: Date.now(), data };
          const next = [entry, ...history.filter((h) => h.query !== q || h.tool !== "teach")].slice(0, MAX_HISTORY);
          setHistory(next);
          saveHistory(next);
          setActive(entry);
          // Schedule spaced repetition reviews (Ebbinghaus curve)
          if (data.mvuRead) {
            scheduleSpacedReview(q, data.mvuRead);
          }
        } else {
          // actions-surface slice · POST /api/integrations/research →
          // trpc.ai.research. The procedure returns the multi-model
          // result ({ content, provider, model }) — `query` is merged
          // in here so the ResearchCard header renders it (the legacy
          // route returned `routeQuery`'s result verbatim, which never
          // carried `query`, so the card header was always blank).
          const result = await researchMut.mutateAsync({
            query: q,
            taskType: "research",
          });
          const data: ResearchResponse = { ...result, query: q };
          const entry: HistoryEntry = { tool: "research", query: q, at: Date.now(), data };
          const next = [entry, ...history.filter((h) => h.query !== q || h.tool !== "research")].slice(0, MAX_HISTORY);
          setHistory(next);
          saveHistory(next);
          setActive(entry);
        }
        setQuery("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
      setLoading(false);
    },
    [query, history, scheduleSpacedReview, teachMut, researchMut]
  );

  const handleDeepDiveActiveReview = useCallback((topic: string, key: string) => {
    setFocusReviewMode(false);
    completeReview(key);
    run(topic, "teach");
  }, [completeReview, run]);

  // Stats
  const totalLearned = history.length;
  const thisWeek = history.filter(
    (h) => Date.now() - h.at < 7 * 86_400_000
  ).length;

  if (focusReviewMode && currentReviewCard) {
    const timerPercent = Math.max(0, Math.min(100, (reviewTimeLeft / 45) * 100));
    const isSummaryVisible = showSummary || reviewTimeLeft === 0;

    return (
      <div className="space-y-4 rounded-xl border border-amber-500/30 bg-zinc-950/80 backdrop-blur-md p-4 animate-fade-in max-w-md mx-auto" id="focus-review-panel">
        {/* Status Bar */}
        <div className="flex items-center justify-between pb-2 border-b border-white/5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
              Focus Review ({activeReviewIdx + 1} of {dueReviews.length})
            </span>
          </div>
          <button
            onClick={() => setFocusReviewMode(false)}
            className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Exit Focus
          </button>
        </div>

        {/* Ebbinghaus Countdown Timer */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-zinc-500">Ebbinghaus Urgency Countdown</span>
            <span className={cn(
              "font-bold",
              reviewTimeLeft <= 10 ? "text-red-400 animate-pulse" : "text-amber-400"
            )}>
              0:{reviewTimeLeft.toString().padStart(2, "0")}
            </span>
          </div>
          <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden border border-white/5">
            <div
              className={cn(
                "h-full transition-all duration-1000 rounded-full",
                reviewTimeLeft <= 10 ? "bg-red-500" : "bg-amber-500"
              )}
              style={{ width: `${timerPercent}%` }}
            />
          </div>
        </div>

        {/* Card Content */}
        <div className="py-6 px-2 text-center space-y-4">
          <h2 className="text-lg font-bold text-zinc-100 tracking-tight leading-snug">
            {currentReviewCard.topic}
          </h2>

          {!isSummaryVisible ? (
            <Button
              onClick={() => setShowSummary(true)}
              variant="outline"
              className="mx-auto h-10 px-6 border-violet-500/30 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200 text-xs font-mono"
            >
              Show Summary
            </Button>
          ) : (
            <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-900/40 text-left text-zinc-300 text-xs leading-relaxed whitespace-pre-wrap animate-fade-in">
              <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                Summary / Insight
              </p>
              {currentReviewCard.summary}
            </div>
          )}
        </div>

        {/* Urgency warning on timer expiry */}
        {reviewTimeLeft === 0 && (
          <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-center animate-bounce">
            <p className="text-[10px] font-bold text-red-400">
              ⏱️ Time's up! Don't overthink, pick an action below.
            </p>
          </div>
        )}

        {/* Actions Row */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => handleCompleteActiveReview(currentReviewCard.key)}
            className="flex-1 min-h-[44px] rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black text-xs font-bold transition-all flex items-center justify-center gap-1.5"
            aria-label="Mark as remembered"
            id="got-it-focus-btn"
          >
            Got It ✓
          </button>
          <button
            onClick={() => handleDeepDiveActiveReview(currentReviewCard.topic, currentReviewCard.key)}
            className="flex-1 min-h-[44px] rounded-lg bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500 hover:text-black text-xs font-bold transition-all flex items-center justify-center gap-1.5"
            aria-label="Deep dive on this topic"
            id="deep-dive-focus-btn"
          >
            Deep Dive
          </button>
          <button
            onClick={handleSkipActiveReview}
            className="min-h-[44px] px-3.5 rounded-lg bg-zinc-900/60 text-zinc-400 border border-zinc-800 hover:bg-zinc-800 hover:text-zinc-200 text-xs font-medium transition-all"
            aria-label="Skip to next review card"
            id="skip-focus-btn"
          >
            Skip
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Spaced repetition: due review cards ── */}
      {dueReviews.length > 0 && !active && !focusReviewMode && (
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-bold uppercase tracking-wider text-amber-400/80 px-0.5">
              Remember this? ({dueReviews.length} due)
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFocusReviewMode(true);
                setActiveReviewIdx(0);
                setReviewTimeLeft(45);
                setShowSummary(false);
              }}
              className="text-[10px] h-7 px-2.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 font-mono font-bold flex items-center gap-1.5 animate-pulse"
              id="adhd-focus-review-btn"
            >
              <Zap size={11} className="fill-amber-400/20" />
              ADHD Focus: Review One Card
            </Button>
          </div>
          {dueReviews.slice(0, 3).map((rev) => (
            <div
              key={rev.key}
              className="rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-2.5 space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-zinc-200">{rev.topic}</p>
                  <p className="text-[10px] text-zinc-400 italic line-clamp-2 mt-0.5">
                    {rev.summary}
                  </p>
                </div>
                <span className="text-[8px] text-amber-400/60 font-mono shrink-0">
                  day {rev.interval}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => run(rev.topic, "teach")}
                  className="text-[9px] px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 hover:bg-violet-500/30 border border-violet-500/20 font-bold"
                >
                  Deep dive
                </button>
                <button
                  onClick={() => completeReview(rev.key)}
                  className="text-[9px] px-2 py-0.5 rounded text-amber-400/70 hover:text-amber-300 border border-amber-500/20"
                >
                  Got it ✓
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Smart input ── */}
      <div className="space-y-2">
        <p className="text-[13px] font-bold text-zinc-200 leading-snug">
          {active
            ? "Ask something else"
            : dueReviews.length > 0
              ? `${dueReviews.length} topics due for review. ${thisWeek} new this week.`
              : totalLearned === 0
                ? "What do you want to learn?"
                : `${thisWeek} topics this week. Keep compounding.`}
        </p>

        <div className="flex gap-1.5">
          <Input
            placeholder="Ask Nick anything — he'll teach or research automatically"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            disabled={loading}
            className="h-9 bg-zinc-900/60 border-zinc-800/40 text-[13px] placeholder:text-zinc-600 focus:border-violet-500/30 transition-all"
          />
          <Button
            size="sm"
            onClick={() => run()}
            disabled={loading || !query.trim()}
            className="h-9 px-3 bg-violet-500/20 text-violet-200 hover:bg-violet-500 hover:text-black border border-violet-500/30 font-bold shrink-0"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={14} />}
          </Button>
        </div>

        {/* Route hint — shows what Nick will do */}
        {detectedTool && !loading && (
          <div className="flex items-center gap-1.5 px-1 text-[9px]">
            {detectedTool === "research" ? (
              <>
                <Globe size={9} className="text-cyan-400" />
                <span className="text-cyan-400/80">Nick will search the live web</span>
              </>
            ) : (
              <>
                <BookOpen size={9} className="text-violet-400" />
                <span className="text-violet-400/80">Nick will build you a micro-course</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Decision-linked learning — "you're deciding X, learn about Y" ── */}
      {!active && activeDecisions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-wider text-cyan-400/80 px-0.5">
            Learn before you decide
          </p>
          {activeDecisions.map((dec, i) => (
            <button
              key={i}
              onClick={() => run(dec.topic, "teach")}
              disabled={loading}
              className="w-full flex items-start gap-2.5 p-2.5 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.03] hover:bg-cyan-500/[0.06] hover:border-cyan-500/30 text-left transition-all group"
            >
              <Lightbulb size={12} className="text-cyan-500/60 group-hover:text-cyan-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-zinc-300 group-hover:text-zinc-100">
                  {dec.topic}
                </p>
                <p className="text-[8px] text-cyan-500/50 mt-0.5 uppercase tracking-wider">
                  Active decision: {dec.title}
                </p>
              </div>
              <ArrowRight size={10} className="text-zinc-700 group-hover:text-cyan-400 shrink-0 mt-1 transition-colors" />
            </button>
          ))}
        </div>
      )}

      {/* ── Suggested topics — never an empty page ── */}
      {!active && history.length < 3 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 px-0.5">
            Suggested for you
          </p>
          <div className="grid grid-cols-1 gap-1">
            {/* v10.0.529.84 · Wave 28 · A2 · goalSeeds (active goals)
                come FIRST · static SUGGESTED_TOPICS fill the rest to
                hit 4 chips total. Goal-driven prompts feel current ·
                static ones are evergreen fallback. */}
            {[...goalSeeds, ...SUGGESTED_TOPICS].slice(0, 4).map((s) => (
              <button
                key={s.query}
                onClick={() => run(s.query, s.tool)}
                disabled={loading}
                className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-800/30 bg-zinc-900/30 hover:bg-zinc-900/60 hover:border-zinc-700 text-left transition-all group"
              >
                <div className="mt-0.5 shrink-0">
                  {s.tool === "research" ? (
                    <Globe size={12} className="text-cyan-500/60 group-hover:text-cyan-400" />
                  ) : (
                    <BookOpen size={12} className="text-violet-500/60 group-hover:text-violet-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-zinc-300 group-hover:text-zinc-100 transition-colors">
                    {s.query}
                  </p>
                  <p className="text-[9px] text-zinc-700 uppercase tracking-wider mt-0.5">
                    {s.category}
                  </p>
                </div>
                <ArrowRight
                  size={11}
                  className="text-zinc-700 group-hover:text-zinc-400 shrink-0 mt-1 transition-colors"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent history — compact, tappable ── */}
      {history.length > 0 && !active && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">
              Your learning
            </p>
            <div className="flex items-center gap-2 text-[9px] text-zinc-700 font-mono">
              <span>{totalLearned} topics</span>
              {thisWeek > 0 && (
                <span className="text-violet-400/70">{thisWeek} this week</span>
              )}
            </div>
          </div>
          <div className="space-y-1">
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => setActive(h)}
                className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-zinc-900/40 text-left transition-colors group"
              >
                <div className="mt-0.5 shrink-0">
                  {h.tool === "teach" ? (
                    <BookOpen size={11} className="text-violet-500/50" />
                  ) : (
                    <Globe size={11} className="text-cyan-500/50" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-zinc-300 group-hover:text-zinc-100 truncate">
                    {h.query}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 text-[8px] text-zinc-700">
                    <Clock size={8} />
                    <span>
                      {new Date(h.at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="uppercase">{h.tool}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Active response: TEACH ── */}
      {active && active.tool === "teach" && (
        <TeachCard
          data={active.data as TeachResponse}
          onDismiss={() => setActive(null)}
          onSpawn={spawnLoop}
          onSaveToBrain={saveToBrain}
          onFollowUp={(q) => { setActive(null); setQuery(q); }}
          spawning={spawning}
        />
      )}

      {/* ── Active response: RESEARCH ── */}
      {active && active.tool === "research" && (
        <ResearchCard
          data={active.data as ResearchResponse}
          onDismiss={() => setActive(null)}
          onSaveToBrain={saveToBrain}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// TEACH response card — interactive, not a text dump
// ──────────────────────────────────────────────────────

function TeachCard({
  data,
  onDismiss,
  onSpawn,
  onSaveToBrain,
  onFollowUp,
  spawning,
}: {
  data: TeachResponse;
  onDismiss: () => void;
  onSpawn: (title: string) => void;
  onSaveToBrain: (topic: string, content: string) => void;
  onFollowUp: (q: string) => void;
  spawning: boolean;
}) {
  const [expandedSection, setExpandedSection] = useState<string | null>("mvu");

  return (
    <div className="space-y-2 rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold text-zinc-100">
            {data.title || data.topic}
          </p>
          {data.overview && (
            <p className="text-[11px] text-zinc-400 italic mt-0.5 leading-relaxed">
              {data.overview}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {data.mvuRead && (
            <button
              onClick={() => onSaveToBrain(data.topic, data.mvuRead!)}
              title="Save to brain"
              className="p-1.5 text-violet-400/50 hover:text-violet-300 rounded-lg hover:bg-violet-500/10"
            >
              <Brain size={12} />
            </button>
          )}
          <button
            onClick={onDismiss}
            className="p-1.5 text-zinc-600 hover:text-zinc-300 rounded-lg hover:bg-zinc-800/50"
          >
            &times;
          </button>
        </div>
      </div>

      {/* MVU — the one thing you NEED to know */}
      {data.mvuRead && (
        <button
          onClick={() => setExpandedSection(expandedSection === "mvu" ? null : "mvu")}
          className="w-full text-left"
        >
          <div className={cn(
            "p-2.5 rounded-lg border transition-all",
            expandedSection === "mvu"
              ? "bg-violet-500/5 border-violet-500/20"
              : "bg-zinc-900/40 border-zinc-800/30 hover:border-zinc-700"
          )}>
            <p className="text-[9px] font-bold uppercase tracking-wider text-violet-400/70 mb-1">
              The one thing to understand
            </p>
            <p className={cn(
              "text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap",
              expandedSection !== "mvu" && "line-clamp-2"
            )}>
              {data.mvuRead}
            </p>
          </div>
        </button>
      )}

      {/* Key concepts — as compact chips that expand */}
      {data.keyConcepts && data.keyConcepts.length > 0 && (
        <button
          onClick={() => setExpandedSection(expandedSection === "concepts" ? null : "concepts")}
          className="w-full text-left"
        >
          <div className={cn(
            "p-2.5 rounded-lg border transition-all",
            expandedSection === "concepts"
              ? "bg-blue-500/5 border-blue-500/20"
              : "bg-zinc-900/40 border-zinc-800/30 hover:border-zinc-700"
          )}>
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-bold uppercase tracking-wider text-blue-400/70">
                Key concepts
              </p>
              <Badge className="bg-zinc-800 text-zinc-500 text-[8px] h-3.5">
                {data.keyConcepts.length}
              </Badge>
            </div>
            {expandedSection === "concepts" && (
              <div className="mt-1.5 space-y-1">
                {data.keyConcepts.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span className="text-blue-400/50 font-mono shrink-0 w-4 text-right">{i + 1}</span>
                    <span className="text-zinc-300">{c}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </button>
      )}

      {/* Rules of thumb + Common mistakes — side by side when expanded */}
      {((data.rulesOfThumb && data.rulesOfThumb.length > 0) ||
        (data.commonMistakes && data.commonMistakes.length > 0)) && (
        <button
          onClick={() => setExpandedSection(expandedSection === "rules" ? null : "rules")}
          className="w-full text-left"
        >
          <div className={cn(
            "p-2.5 rounded-lg border transition-all",
            expandedSection === "rules"
              ? "bg-zinc-900/60 border-zinc-700"
              : "bg-zinc-900/40 border-zinc-800/30 hover:border-zinc-700"
          )}>
            <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
              Rules &amp; pitfalls
            </p>
            {expandedSection === "rules" && (
              <div className="mt-1.5 space-y-2">
                {data.rulesOfThumb && data.rulesOfThumb.length > 0 && (
                  <div className="space-y-0.5">
                    {data.rulesOfThumb.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10px]">
                        <Lightbulb size={9} className="text-amber-400/60 shrink-0 mt-0.5" />
                        <span className="text-zinc-400">{r}</span>
                      </div>
                    ))}
                  </div>
                )}
                {data.commonMistakes && data.commonMistakes.length > 0 && (
                  <div className="space-y-0.5">
                    {data.commonMistakes.map((m, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10px]">
                        <AlertTriangle size={9} className="text-red-400/60 shrink-0 mt-0.5" />
                        <span className="text-zinc-400">{m}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </button>
      )}

      {/* TRY TODAY — the big action. Prominent, not buried. */}
      {data.tryToday && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <Zap size={12} className="text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/80 mb-0.5">
              Try today
            </p>
            <p className="text-[12px] text-zinc-200">{data.tryToday}</p>
          </div>
          <button
            onClick={() => onSpawn(data.tryToday!)}
            disabled={spawning}
            className="shrink-0 px-2.5 py-1 rounded-md bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500 hover:text-black text-[9px] font-bold border border-emerald-500/30 transition-all"
          >
            <Plus size={10} className="inline mr-0.5" />
            Loop it
          </button>
        </div>
      )}

      {/* Resources */}
      {data.resources && data.resources.length > 0 && (
        <div className="space-y-0.5 pt-1 border-t border-zinc-800/30">
          <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">
            Go deeper
          </p>
          {data.resources.map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-[10px]">
              <ExternalLink size={9} className="text-cyan-400/50 shrink-0 mt-0.5" />
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-300 hover:text-cyan-200 underline truncate"
                >
                  {r.title}
                </a>
              ) : (
                <span className="text-zinc-400">{r.title}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Learning path chain — structured progression, not random follow-ups */}
      {data.learningPath && data.learningPath.length > 0 && (
        <div className="pt-2 border-t border-zinc-800/30">
          <p className="text-[9px] font-bold uppercase tracking-wider text-violet-400/70 mb-1.5">
            Your learning path
          </p>
          <div className="space-y-1">
            {data.learningPath.map((step, i) => (
              <button
                key={i}
                onClick={() => onFollowUp(step.topic)}
                className="w-full flex items-start gap-2.5 p-2 rounded-lg border border-zinc-800/30 bg-zinc-900/30 hover:bg-zinc-900/60 hover:border-violet-500/20 text-left transition-all group"
              >
                <div className="flex flex-col items-center shrink-0 mt-0.5">
                  <span className="w-5 h-5 rounded-full bg-violet-500/10 border border-violet-500/30 flex items-center justify-center text-[9px] font-bold text-violet-400">
                    {i + 1}
                  </span>
                  {i < (data.learningPath?.length ?? 0) - 1 && (
                    <span className="w-px h-3 bg-violet-500/20 mt-0.5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-zinc-300 group-hover:text-zinc-100 font-medium">
                    {step.topic}
                  </p>
                  <p className="text-[9px] text-zinc-600 mt-0.5">{step.why}</p>
                </div>
                <ArrowRight size={10} className="text-zinc-700 group-hover:text-violet-400 shrink-0 mt-1 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Next questions — simpler follow-ups */}
      {data.nextQuestions && data.nextQuestions.length > 0 && !data.learningPath?.length && (
        <div className="space-y-1 pt-1 border-t border-zinc-800/30">
          <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">
            Keep going
          </p>
          {data.nextQuestions.map((q, i) => (
            <button
              key={i}
              onClick={() => onFollowUp(q)}
              className="w-full flex items-start gap-2 text-[10px] text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800/30 text-left transition-colors"
            >
              <ArrowRight size={9} className="shrink-0 mt-0.5" />
              <span>{q}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// RESEARCH response card
// ──────────────────────────────────────────────────────

function ResearchCard({
  data,
  onDismiss,
  onSaveToBrain,
}: {
  data: ResearchResponse;
  onDismiss: () => void;
  onSaveToBrain: (topic: string, content: string) => void;
}) {
  const cites = data.citations && data.citations.length > 0 ? data.citations : [];
  return (
    <div className="space-y-2 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Globe size={14} className="text-cyan-400 shrink-0" />
          <p className="text-[14px] font-bold text-zinc-100 truncate">{data.query}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {data.content && (
            <button
              onClick={() => onSaveToBrain(data.query, data.content!)}
              title="Save to brain"
              className="p-1.5 text-cyan-400/50 hover:text-cyan-300 rounded-lg hover:bg-cyan-500/10"
            >
              <Brain size={12} />
            </button>
          )}
          <button
            onClick={onDismiss}
            className="p-1.5 text-zinc-600 hover:text-zinc-300 rounded-lg hover:bg-zinc-800/50"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Provider badge */}
      {data.provider && (
        <Badge className="bg-zinc-800/50 text-zinc-500 text-[8px] h-3.5 uppercase tracking-wider">
          via {data.provider}
        </Badge>
      )}

      {/* Content */}
      {data.content && (
        <p className="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
          {data.content}
        </p>
      )}

      {/* Citations */}
      {cites.length > 0 && (
        <div className="space-y-0.5 pt-1.5 border-t border-zinc-800/30">
          <p className="text-[9px] font-bold uppercase tracking-wider text-cyan-400/60">
            Sources ({cites.length})
          </p>
          {cites.map((c, i) => (
            <a
              key={i}
              href={c}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[9px] text-cyan-300 hover:text-cyan-200 underline truncate"
            >
              {c}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
