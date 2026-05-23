"use client";

/**
 * /decisions/[id] · v10.0.221 · single-decision detail.
 *
 * Showcase of the DecisionSpread primitive. Layout, top to bottom:
 *
 *   ┌─ header · title + domain + stakes + status chip
 *   ├─ timeline · age · review countdown · review status
 *   ├─ TrendCounter row · 4 cards (age, review-due, sibling-grades-avg, anti-patterns)
 *   ├─ MAIN SPREAD · prediction ↔ outcome with grade in the connector
 *   │  · LEFT  · context · options considered · chosen · reasoning
 *   │  · RIGHT · actual outcome · grade · post-mortem
 *   ├─ Anti-pattern hints · DecisionSpread cards (3) for matching
 *   │  domain lessons — the operator gets to consult them inline
 *   ├─ Sibling decisions · last 5 same-domain (each is a small spread)
 *   └─ Edit panel · grade form · review date · action buttons
 *
 * The page is the test for whether DecisionSpread scales beyond list
 * surfaces. Multiple spreads on one page, each with different score
 * types (grade letter, revisit count, similarity).
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
// misc-pages slice (2026-05-22) · the detail read + grade-save moved
// off authedFetch onto trpc.operator.decisionDetail / gradeDecision.
import { trpc } from "@/lib/trpc/client";
import { notifyDataChanged, onDataChanged } from "@/lib/events/data-change";
import { Panel } from "@/components/panel";
import { PageHeader } from "@/components/layout/ui";
import { TrendCounter } from "@/components/ui/trend-counter";
import { DecisionSpread } from "@/components/ui/decision-spread";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import {
  ComparisonMatrix,
  type MatrixCell,
  type MatrixCriterion,
  type MatrixOption,
} from "@/components/ui/comparison-matrix";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ChevronLeft, AlertCircle, BookOpen } from "lucide-react";

interface Decision {
  id: number;
  date: string;
  title: string;
  domain: string | null;
  stakes: string | null;
  context: string | null;
  optionsConsidered: string | null;
  chosen: string | null;
  reasoning: string | null;
  predictedOutcome: string | null;
  emotionalState: string | null;
  reviewDate: string | null;
  actualOutcome: string | null;
  grade: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Sibling {
  id: number;
  date: string;
  title: string;
  grade: string | null;
  actualOutcome: string | null;
  reviewDate: string | null;
}

interface AntiPattern {
  key: string;
  content: string;
  seenCount: number | null;
  metadata: Record<string, unknown> | null;
}

interface DetailPayload {
  decision: Decision;
  lineage: { siblings: Sibling[]; antiPatterns: AntiPattern[] };
  timeline: {
    ageDays: number;
    reviewDueDays: number | null;
    isReviewed: boolean;
    isOverdue: boolean;
  };
}

const GRADE_NUMERIC: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
function gradeToNumeric(grade: string | null): number {
  if (!grade) return 0;
  const g = grade.trim().toUpperCase().charAt(0);
  return GRADE_NUMERIC[g] ?? 0;
}

function gradeTone(grade: string | null): "emerald" | "gold" | "amber" | "rose" | "tertiary" {
  if (!grade) return "tertiary";
  const n = gradeToNumeric(grade);
  if (n >= 3.5) return "emerald";
  if (n >= 2.5) return "gold";
  if (n >= 1.5) return "amber";
  return "rose";
}

export default function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const numericId = Number(id);
  const idValid = Number.isInteger(numericId) && numericId > 0;

  // ── Edit form state ─────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editOutcome, setEditOutcome] = useState("");
  const [editGrade, setEditGrade] = useState<string>("");
  const [editReviewDate, setEditReviewDate] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Reactive detail read · `cache: "no-store"` carries over as a
  // staleTime-0 query keyed on the id. `enabled` gates the call until
  // the route param resolves to a valid positive int.
  const detailQuery = trpc.operator.decisionDetail.useQuery(
    { id: numericId },
    { enabled: idValid },
  );
  const data = (detailQuery.data ?? null) as DetailPayload | null;
  const loading = detailQuery.isLoading;
  const error = detailQuery.error ? detailQuery.error.message : null;
  const fetchedAt = detailQuery.dataUpdatedAt
    ? new Date(detailQuery.dataUpdatedAt).toISOString()
    : null;

  // Seed the edit form whenever fresh decision data lands (the legacy
  // load() seeded these inside its .then()).
  useEffect(() => {
    if (!data) return;
    setEditOutcome(data.decision.actualOutcome ?? "");
    setEditGrade(data.decision.grade ?? "");
    setEditReviewDate(data.decision.reviewDate ?? "");
  }, [data]);

  // v10.0.529.89 · Wave 33 · split-pane refresh · when Nick grades or
  // reviews this decision via chat (reviewDecisionReplay tool fires
  // "journal" domain), the open detail page refreshes instantly.
  // Pre-Wave-33 the operator could see Nick's grade in the chat
  // transcript while this page still showed the old grade · jarring.
  useEffect(() => {
    return onDataChanged(["journal"], () => void detailQuery.refetch());
  }, [detailQuery]);

  const gradeDecision = trpc.operator.gradeDecision.useMutation();

  async function save() {
    if (!idValid) return;
    setSaving(true);
    try {
      await gradeDecision.mutateAsync({
        id: numericId,
        actualOutcome: editOutcome || undefined,
        grade: editGrade || undefined,
        reviewDate: editReviewDate || undefined,
      });
      toast.success("decision updated");
      setEditing(false);
      await detailQuery.refetch();
      // v10.0.529.90 · Wave 34 · symmetric notify. Wave 33 wired this
      // page to LISTEN for "journal" events from chat-driven grading ·
      // now it also EMITS so /journal list + any split-pane view
      // refresh when the operator grades from the detail page.
      notifyDataChanged("journal", { source: "decisions-page", detail: "decision-grade", id });
    } catch (e) {
      toast.error(`save failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-5xl px-3 py-6">
        <p className="text-[11px] text-[var(--text-tertiary)]">loading decision…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-5xl px-3 py-6">
        <Panel className="border-rose-500/30 bg-rose-500/[0.04]">
          <div className="flex items-start gap-3 p-3">
            <AlertCircle size={14} className="text-rose-300/80 mt-0.5" />
            <div>
              <p className="text-[12px] font-bold text-rose-300">load failed</p>
              <p className="text-[10px] text-rose-300/70 mt-0.5 font-mono">{error}</p>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  if (!data) return null;

  const { decision: d, lineage, timeline } = data;
  const tone = gradeTone(d.grade);

  // Avg sibling grade — surface the domain trend so the operator
  // sees "this domain has been at C+ on average; this F is an outlier."
  const siblingGrades = lineage.siblings
    .map((s) => (s.grade ? gradeToNumeric(s.grade) : null))
    .filter((n): n is number => n !== null);
  const siblingAvgGrade =
    siblingGrades.length > 0
      ? siblingGrades.reduce((a, b) => a + b, 0) / siblingGrades.length
      : null;

  // ─── ComparisonMatrix data · current + siblings × 4 criteria ──────
  // The "options" are the current decision and its same-domain siblings ·
  // the "criteria" are the dimensions an operator wants to scan across
  // a domain (grade · how-fresh · review-status · has-outcome). The
  // current decision is pinned to row 1 with a "(this)" label so the
  // operator can locate it inside the sort.
  const matrixOptions: MatrixOption[] = [
    {
      id: `current-${d.id}`,
      label: `${d.title.slice(0, 48)} · (this)`,
      _grade: d.grade,
      _ageDays: timeline.ageDays,
      _reviewDueDays: timeline.reviewDueDays,
      _hasOutcome: !!d.actualOutcome,
    },
    ...lineage.siblings.map((s) => {
      const ageDays = Math.max(
        0,
        Math.round((Date.now() - new Date(s.date).getTime()) / 86_400_000),
      );
      const reviewDueDays = s.reviewDate
        ? Math.round(
            (new Date(s.reviewDate).getTime() - Date.now()) / 86_400_000,
          )
        : null;
      return {
        id: `sib-${s.id}`,
        label: s.title.slice(0, 48),
        _grade: s.grade,
        _ageDays: ageDays,
        _reviewDueDays: reviewDueDays,
        _hasOutcome: !!s.actualOutcome,
      };
    }),
  ];

  const matrixCriteria: MatrixCriterion[] = [
    { id: "grade", label: "grade", higherIsBetter: true },
    { id: "age", label: "age (days)", higherIsBetter: false },
    { id: "review", label: "review (days)", higherIsBetter: true },
    { id: "outcome", label: "outcome", higherIsBetter: true },
  ];

  const matrixCells = (
    opt: MatrixOption,
    crit: MatrixCriterion,
  ): MatrixCell => {
    const grade = opt._grade as string | null;
    const ageDays = opt._ageDays as number;
    const reviewDueDays = opt._reviewDueDays as number | null;
    const hasOutcome = opt._hasOutcome as boolean;

    switch (crit.id) {
      case "grade":
        return grade
          ? { value: grade, score: gradeToNumeric(grade), display: grade }
          : { value: null };
      case "age":
        return { value: ageDays, score: ageDays };
      case "review":
        return reviewDueDays === null
          ? { value: null, display: "no date" }
          : { value: reviewDueDays, score: reviewDueDays };
      case "outcome":
        return {
          value: hasOutcome ? "yes" : "no",
          score: hasOutcome ? 1 : 0,
          display: hasOutcome ? "yes" : "no",
        };
      default:
        return { value: null };
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-3 py-4 sm:px-4 sm:py-6">
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push("/system/decision-drift")}
          className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
        >
          <ChevronLeft size={11} /> decision-drift
        </button>
      </div>

      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <span>decision · {d.date}</span>
            {d.domain && (
              <span className="font-mono tracking-[0.18em] opacity-80">
                {d.domain.slice(0, 4).toUpperCase()}
              </span>
            )}
            {d.stakes && (
              <span className="rounded border border-[var(--gold)]/30 bg-[var(--gold)]/[0.05] px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-[var(--gold)]/90 normal-case">
                {d.stakes} stakes
              </span>
            )}
          </span>
        }
        title={d.title}
        description={
          timeline.isReviewed
            ? `reviewed · grade ${d.grade ?? "—"} · logged ${timeline.ageDays}d ago`
            : timeline.isOverdue
              ? `overdue review · ${Math.abs(timeline.reviewDueDays!)}d past due`
              : timeline.reviewDueDays !== null
                ? `review in ${timeline.reviewDueDays}d`
                : `unreviewed · logged ${timeline.ageDays}d ago`
        }
        actions={
          <div className="flex items-center gap-2">
            <FreshnessChip
              lastFetchedAt={fetchedAt}
              source="api/decisions/[id]"
              onReload={() => void detailQuery.refetch()}
            />
            <button
              onClick={() => setEditing((v) => !v)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-[11px] font-medium transition",
                editing
                  ? "border-zinc-600 bg-zinc-800 text-zinc-200"
                  : "border-[var(--gold)]/40 bg-[var(--gold)]/[0.08] text-[var(--gold)] hover:bg-[var(--gold)]/15",
              )}
            >
              {editing ? "× cancel" : timeline.isReviewed ? "edit" : "grade decision"}
            </button>
          </div>
        }
      />

      {/* ── Timeline TrendCounter row ───────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TrendCounter
          value={timeline.ageDays}
          label="age · days since logged"
          goodWhen="neutral"
          tone="tertiary"
        />
        <TrendCounter
          value={timeline.reviewDueDays ?? 0}
          label={
            timeline.reviewDueDays === null
              ? "no review date set"
              : timeline.isOverdue
                ? "days OVERDUE"
                : "days to review"
          }
          goodWhen="high"
          tone={
            timeline.reviewDueDays === null ? "tertiary"
            : timeline.isOverdue ? "rose"
            : timeline.reviewDueDays < 7 ? "amber"
            : "emerald"
          }
          format={(n) => timeline.reviewDueDays === null ? "—" : `${Math.abs(n)}`}
        />
        <TrendCounter
          value={siblingAvgGrade ?? 0}
          label={
            siblingAvgGrade === null
              ? "no domain history"
              : `${d.domain ?? "domain"} avg · ${siblingGrades.length} graded`
          }
          goodWhen="high"
          tone={
            siblingAvgGrade === null ? "tertiary"
            : siblingAvgGrade >= 3 ? "emerald"
            : siblingAvgGrade >= 2 ? "gold"
            : "rose"
          }
          format={(n) => siblingAvgGrade === null ? "—" : `${n.toFixed(1)}/4`}
        />
        <TrendCounter
          value={lineage.antiPatterns.length}
          label="domain anti-patterns"
          goodWhen="neutral"
          tone={lineage.antiPatterns.length > 0 ? "amber" : "tertiary"}
        />
      </div>

      {/* ── MAIN SPREAD · the page's centerpiece ───────────────── */}
      <DecisionSpread
        leftLabel={
          <span className="inline-flex items-center gap-2">
            <span>predicted</span>
            {d.emotionalState && (
              <span className="rounded bg-[var(--gold)]/[0.06] px-1.5 py-px text-[9px] tracking-wider text-[var(--gold)]/80 normal-case">
                {d.emotionalState}
              </span>
            )}
          </span>
        }
        leftTitle={d.chosen ?? "no choice recorded"}
        leftBody={d.predictedOutcome ?? d.context ?? "no prediction"}
        leftMeta={
          d.optionsConsidered
            ? `options · ${d.optionsConsidered.slice(0, 80)}`
            : d.reasoning
              ? `reasoning · ${d.reasoning.slice(0, 80)}`
              : undefined
        }
        score={gradeToNumeric(d.grade)}
        scoreFormat={() => d.grade ?? "—"}
        scoreLabel={timeline.isReviewed ? "graded" : "ungraded"}
        rightLabel="actual"
        rightTitle={
          d.actualOutcome
            ? d.actualOutcome.slice(0, 80)
            : timeline.isOverdue
              ? "OVERDUE — outcome not yet recorded"
              : "outcome not yet recorded"
        }
        rightBody={
          d.actualOutcome && d.actualOutcome.length > 80 ? (
            <p className="text-[12px] leading-relaxed">
              {d.actualOutcome.slice(80, 600)}
              {d.actualOutcome.length > 600 && "…"}
            </p>
          ) : !timeline.isReviewed ? (
            <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)] italic">
              {timeline.reviewDueDays !== null && timeline.reviewDueDays >= 0
                ? `Review opens in ${timeline.reviewDueDays}d. The page will let you grade then — or click "grade decision" above to log the outcome now.`
                : "Click 'grade decision' above to record the actual outcome."}
            </p>
          ) : null
        }
      />

      {/* ── Edit form · folds out below the spread ───────────────── */}
      {editing && (
        <Panel className="border-[var(--gold)]/30 bg-[var(--gold)]/[0.03]">
          <div className="space-y-3 p-3">
            <h3 className="text-sm font-semibold text-[var(--gold)]">
              {timeline.isReviewed ? "Edit grade" : "Grade decision"}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  actual outcome
                </label>
                <textarea
                  value={editOutcome}
                  onChange={(e) => setEditOutcome(e.target.value)}
                  rows={4}
                  placeholder="what actually happened — blunt, specific, with numbers when possible"
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg-base)]/60 px-3 py-2 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--gold)]/60 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  grade
                </label>
                <select
                  value={editGrade}
                  onChange={(e) => setEditGrade(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg-base)]/60 px-3 py-2 text-[12px] text-[var(--text-primary)] focus:border-[var(--gold)]/60 focus:outline-none"
                >
                  <option value="">— pick —</option>
                  <option value="A">A · prediction held + outcome was great</option>
                  <option value="B">B · prediction mostly right</option>
                  <option value="C">C · partial · some wrong</option>
                  <option value="D">D · prediction wrong, recoverable</option>
                  <option value="F">F · totally missed it</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  next review date
                </label>
                <input
                  type="date"
                  value={editReviewDate}
                  onChange={(e) => setEditReviewDate(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg-base)]/60 px-3 py-2 text-[12px] text-[var(--text-primary)] focus:border-[var(--gold)]/60 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-md border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-700/60"
              >
                cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={saving || !editGrade || !editOutcome}
                className="rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/[0.12] px-3 py-1.5 text-[11px] text-[var(--gold)] hover:bg-[var(--gold)]/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? "saving…" : "save grade"}
              </button>
            </div>
          </div>
        </Panel>
      )}

      {/* ── Anti-pattern hints · DecisionSpread for matching domain ── */}
      {lineage.antiPatterns.length > 0 && (
        <section className="space-y-2">
          <header className="flex items-baseline justify-between">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              anti-patterns in {d.domain}
            </p>
            <Link
              href="/system/quality?view=lessons"
              className="text-[10px] font-mono tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)]"
            >
              full library →
            </Link>
          </header>
          <div className="space-y-2">
            {lineage.antiPatterns.map((ap) => {
              const meta = (ap.metadata ?? {}) as Record<string, unknown>;
              const attempt = (meta.attempt as string | undefined) ?? ap.content.slice(0, 80);
              const outcome = (meta.outcome as string | undefined) ?? "";
              const lesson = (meta.lesson as string | undefined) ?? ap.content;
              return (
                <DecisionSpread
                  key={ap.key}
                  leftLabel={
                    <span className="inline-flex items-center gap-2">
                      <BookOpen size={10} className="opacity-70" />
                      <span>past attempt</span>
                    </span>
                  }
                  leftTitle={attempt}
                  leftBody={lesson}
                  leftMeta={`#${ap.key}`}
                  score={ap.seenCount ?? 0}
                  scoreFormat={(n) => `${n}×`}
                  scoreLabel="revisited"
                  rightLabel="outcome learned"
                  rightTitle={outcome || "see lesson"}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* ── Sibling decisions in the same domain ─────────────────── */}
      {lineage.siblings.length > 0 && (
        <section className="space-y-2">
          <header className="flex items-baseline justify-between">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              siblings in {d.domain}
            </p>
            <span className="text-[10px] font-mono tracking-wider text-[var(--text-tertiary)]/70">
              {siblingGrades.length}/{lineage.siblings.length} graded
            </span>
          </header>
          <div className="space-y-1.5">
            {lineage.siblings.map((s) => (
              <Link
                key={s.id}
                href={`/decisions/${s.id}`}
                className="block"
              >
                <GlassCard className="hover:border-[var(--gold)]/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-[var(--text-tertiary)] tabular-nums w-20 shrink-0">
                      {s.date}
                    </span>
                    <span className="flex-1 text-[12px] text-[var(--text-primary)] truncate">
                      {s.title}
                    </span>
                    {s.grade ? (
                      <span
                        className={cn(
                          "font-mono text-sm font-bold tabular-nums w-7 text-right",
                          s.grade === "A" || s.grade === "B" ? "text-emerald-300"
                          : s.grade === "C" ? "text-[var(--gold)]"
                          : "text-rose-300",
                        )}
                      >
                        {s.grade}
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]/70 w-7 text-right">
                        —
                      </span>
                    )}
                  </div>
                </GlassCard>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── ComparisonMatrix · domain scan view ────────────────────
       *   Shipped 2026-05-23 · task #8 from operator backlog. Renders
       *   current decision + siblings as a dense grid keyed by 4 criteria
       *   so the operator can scan a domain in one glance instead of
       *   reading individual sibling cards. Per-column color-coding
       *   surfaces outliers (the F in a string of A's, the 200-day-old
       *   unreviewed decision in a domain with 30-day cadence). Only
       *   rendered when there's at least one sibling — with just the
       *   current decision the matrix is 1 × N, which is just a label
       *   row and contributes no signal.
       */}
      {lineage.siblings.length > 0 && (
        <section className="space-y-2">
          <header>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              domain scan · {d.domain ?? "all"}
            </p>
          </header>
          <ComparisonMatrix
            options={matrixOptions}
            criteria={matrixCriteria}
            cells={matrixCells}
            caption="current decision + siblings · per-column color-coding · click a header to sort"
            defaultSortCriterion="grade"
          />
        </section>
      )}

      {/* ── Reasoning + context · expanded fields below the fold ── */}
      <Panel>
        <div className="grid gap-4 p-3 md:grid-cols-2">
          {d.context && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] mb-1.5">
                context
              </p>
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                {d.context}
              </p>
            </div>
          )}
          {d.reasoning && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] mb-1.5">
                reasoning
              </p>
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                {d.reasoning}
              </p>
            </div>
          )}
          {d.optionsConsidered && (
            <div className="md:col-span-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] mb-1.5">
                options considered
              </p>
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                {d.optionsConsidered}
              </p>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
