"use client";

/**
 * SkillLibraryPanel — Nour's curation surface for auto-extracted
 * behavioral skills. Apr 18.
 *
 * Three tabs:
 *   • Candidates — pending patterns from the last 30d of DONE tasks.
 *                  Promote to active OR drop forever.
 *   • Active     — skills Nour has curated. Shows live success_rate
 *                  as they reinforce on each matching DONE. Graduate
 *                  when proven (silent-track) or drop if they stop
 *                  serving.
 *   • Graduated  — proven + silent. Reference only; no more nudging.
 *
 * Data lives in BrainMemory (category "skill" + "skill_pending") so
 * there's no schema. All curation goes through /api/skills.
 */

import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ArrowUp,
  GraduationCap,
  Trash2,
  Loader2,
  CheckCircle2,
  Eye,
  Target,
  AlertTriangle,
  Pencil,
  Play,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { relativeTimeMinutes as timeAgo } from "@/lib/utils/datetime";

interface StoredSkill {
  dbId: string;
  key: string;
  pending: boolean;
  trigger: string;
  trigger_signals: string[];
  action_sequence: string[];
  action_verb: string | null;
  keywords: string[];
  tier: "tiny" | "tactical" | "strategic";
  polarity: "do" | "avoid";
  times_fired: number;
  times_succeeded: number;
  times_failed: number;
  success_rate: number;
  last_fired: string | null;
  graduated: boolean;
  manually_reviewed: boolean;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

// Stale: not fired in 30 days
function isStale(s: StoredSkill): boolean {
  if (!s.last_fired) return false;
  const days = (Date.now() - new Date(s.last_fired).getTime()) / 86400_000;
  return days > 30;
}

type Tab = "candidates" | "active" | "graduated";

function tierColor(tier: StoredSkill["tier"]): string {
  return tier === "tiny" ? "text-emerald-400" : tier === "tactical" ? "text-[var(--gold)]" : "text-violet-400";
}

export function SkillLibraryPanel() {
  const [tab, setTab] = useState<Tab>("candidates");
  const [busy, setBusy] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editTrigger, setEditTrigger] = useState("");
  const [editAction, setEditAction] = useState("");

  // Phase UU.2 (2026-05-22) · REST→tRPC · the active + pending skill
  // lists are a typed query (operator.skills). The legacy route
  // wrapped the payload in `{ data }`; the procedure returns
  // { active, pending } directly. lastFetchedAt derives from React
  // Query's dataUpdatedAt. All four curation paths (promote · drop ·
  // graduate · ungraduate · edit · extract_now) go through the single
  // operator.curateSkill mutation — the same multiplexed endpoint the
  // REST PATCH was — then invalidate the query to refetch.
  const utils = trpc.useUtils();
  const skillsQuery = trpc.operator.skills.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const active: StoredSkill[] | null = (skillsQuery.data?.active ??
    null) as StoredSkill[] | null;
  const pending: StoredSkill[] | null = (skillsQuery.data?.pending ??
    null) as StoredSkill[] | null;
  const loading = skillsQuery.isPending;
  const lastFetchedAt = skillsQuery.dataUpdatedAt
    ? new Date(skillsQuery.dataUpdatedAt)
    : null;
  const error = skillsQuery.error
    ? skillsQuery.error.message || "failed to load"
    : null;
  const load = useCallback(() => void skillsQuery.refetch(), [skillsQuery]);

  const curateMutation = trpc.operator.curateSkill.useMutation();
  const extracting =
    curateMutation.isPending &&
    curateMutation.variables?.action === "extract_now";

  const act = useCallback(
    async (
      key: string,
      action: "promote" | "drop" | "graduate" | "ungraduate",
      kind?: "skill" | "skill_pending",
    ) => {
      setBusy(key);
      try {
        await curateMutation.mutateAsync({ key, action, kind });
        toast.success(
          action === "promote"
            ? "skill promoted to active"
            : action === "drop"
              ? "skill dropped"
              : action === "graduate"
                ? "skill graduated (silent-track)"
                : "skill back to active",
        );
        await utils.operator.skills.invalidate();
      } catch (e) {
        toast.error(`${action} failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(null);
      }
    },
    [curateMutation, utils],
  );

  const extractNow = useCallback(async () => {
    try {
      const res = await curateMutation.mutateAsync({ action: "extract_now" });
      // The procedure returns { ok, result } for extract_now · result
      // shape comes straight from extractSkillsFromTasks.
      const r =
        "result" in res
          ? (res.result as {
              newCandidates?: number;
              bySource?: Record<string, number>;
            })
          : undefined;
      const newN = r?.newCandidates ?? 0;
      const parts = [
        r?.bySource?.tasks ? `${r.bySource.tasks} tasks` : "",
        r?.bySource?.promises ? `${r.bySource.promises} broken promises` : "",
        r?.bySource?.reflections ? `${r.bySource.reflections} reflections` : "",
      ].filter(Boolean);
      toast.success(
        newN > 0 ? `${newN} new candidates${parts.length ? ` · ${parts.join(" · ")}` : ""}` : "no new candidates",
      );
      setTab("candidates");
      await utils.operator.skills.invalidate();
    } catch (e) {
      toast.error(`extract failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [curateMutation, utils]);

  const startEdit = useCallback((s: StoredSkill) => {
    setEditKey(s.key);
    setEditTrigger(s.trigger);
    setEditAction(s.action_sequence[0] ?? "");
  }, []);

  const cancelEdit = useCallback(() => {
    setEditKey(null);
    setEditTrigger("");
    setEditAction("");
  }, []);

  const saveEdit = useCallback(
    async (s: StoredSkill) => {
      if (!editKey) return;
      setBusy(editKey);
      try {
        await curateMutation.mutateAsync({
          key: editKey,
          action: "edit",
          kind: s.pending ? "skill_pending" : "skill",
          trigger: editTrigger,
          actionText: editAction,
        });
        toast.success("skill edited");
        cancelEdit();
        await utils.operator.skills.invalidate();
      } catch (e) {
        toast.error(`edit failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(null);
      }
    },
    [editKey, editTrigger, editAction, curateMutation, cancelEdit, utils],
  );

  const candidates = pending ?? [];
  const activeLive = useMemo(() => (active ?? []).filter((s) => !s.graduated), [active]);
  const graduated = useMemo(() => (active ?? []).filter((s) => s.graduated), [active]);

  const [filter, setFilter] = useState("");
  const listForTab = tab === "candidates" ? candidates : tab === "active" ? activeLive : graduated;
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return listForTab;
    return listForTab.filter((s) => {
      if (s.trigger.toLowerCase().includes(q)) return true;
      if (s.action_sequence[0]?.toLowerCase().includes(q)) return true;
      if (s.keywords?.some((k) => k.includes(q))) return true;
      return false;
    });
  }, [listForTab, filter]);

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="section-label">Skill Library</p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
            patterns pulled from your wins · promote the ones that track · graduate when proven
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* v8.2 D5 — freshness + provenance for the data view */}
          <FreshnessChip
            lastFetchedAt={lastFetchedAt}
            source="api/skills"
            onReload={() => void load()}
            compact
          />
          <button
            onClick={() => void extractNow()}
            disabled={extracting}
            className={cn(
              "text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border transition-colors inline-flex items-center gap-1",
              extracting
                ? "opacity-60 border-[var(--border-default)] text-[var(--text-tertiary)]"
                : "border-[var(--gold)]/30 text-[var(--gold)] hover:bg-[var(--gold)]/10",
            )}
            title="run extractor now (tasks + promises + reflections)"
          >
            {extracting ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
            {extracting ? "extracting…" : "extract now"}
          </button>
          <button
            onClick={() => void load()}
            className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
          >
            refresh
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-2">
        <input
          type="text"
          placeholder="search triggers / actions / keywords…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-2 py-1.5 bg-[var(--bg-base)] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--gold)]/30"
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-3 border-b border-[var(--border-default)] pb-2">
        {(
          [
            { id: "candidates" as const, label: "candidates", count: candidates.length, glyph: Target },
            { id: "active" as const, label: "active", count: activeLive.length, glyph: CheckCircle2 },
            { id: "graduated" as const, label: "graduated", count: graduated.length, glyph: Eye },
          ]
        ).map((t) => {
          const Glyph = t.glyph;
          const sel = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={sel}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-colors",
                sel
                  ? "bg-[var(--gold)]/10 text-[var(--gold)] border border-[var(--gold)]/30"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-transparent",
              )}
            >
              <Glyph size={10} />
              {t.label}
              <span className={cn("tabular-nums", sel ? "text-[var(--gold)]" : "text-[var(--text-tertiary)]")}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {loading && !active && !pending && (
        <div className="flex items-center gap-2 py-6 justify-center text-[11px] text-[var(--text-tertiary)]">
          <Loader2 size={12} className="animate-spin" />
          loading skills…
        </div>
      )}
      {error && <div className="text-[11px] text-red-400 py-2">failed: {error}</div>}

      {/* List */}
      <div className="space-y-1">
        {visible.map((s) => {
          const rate = Math.round(s.success_rate * 100);
          const action = s.action_sequence[0] ?? "(no action)";
          const rowBusy = busy === s.key;
          const stale = isStale(s);
          const editing = editKey === s.key;
          return (
            <div
              key={s.key}
              className={cn(
                "group px-2 py-2 rounded border transition-colors",
                "bg-[var(--bg-base)] border-[var(--border-default)]",
                rowBusy && "opacity-60",
                stale && tab !== "graduated" && "border-amber-500/30 bg-amber-500/5",
                s.polarity === "avoid" && "border-red-500/20",
              )}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {editing ? (
                    <div className="space-y-2">
                      <div>
                        <label className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                          trigger
                        </label>
                        <input
                          value={editTrigger}
                          onChange={(e) => setEditTrigger(e.target.value)}
                          className="w-full mt-0.5 px-2 py-1 text-[11px] bg-[var(--bg-overlay)] border border-[var(--border-default)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]/30"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                          action
                        </label>
                        <input
                          value={editAction}
                          onChange={(e) => setEditAction(e.target.value)}
                          className="w-full mt-0.5 px-2 py-1 text-[11px] bg-[var(--bg-overlay)] border border-[var(--border-default)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]/30"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-[var(--text-primary)]">
                          when <span className={cn(s.polarity === "avoid" ? "text-red-400" : "text-[var(--gold)]")}>{s.trigger}</span>
                        </span>
                        <span className={cn("text-[9px] font-mono uppercase tracking-wider", tierColor(s.tier))}>
                          {s.tier}
                        </span>
                        {s.polarity === "avoid" && (
                          <span className="text-[9px] font-mono uppercase tracking-wider text-red-400">avoid</span>
                        )}
                        {stale && tab !== "graduated" && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-mono uppercase tracking-wider text-amber-400">
                            <AlertTriangle size={9} /> stale
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                        {s.polarity === "avoid" ? "⛔" : "→"} {action}
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[9px] font-mono text-[var(--text-tertiary)]">
                        <span>
                          {s.times_succeeded}/{s.times_fired}
                          {s.times_fired > 0 && ` · ${rate}%`}
                          {s.times_failed > 0 && ` · ${s.times_failed} fail`}
                        </span>
                        <span>last {timeAgo(s.last_fired)}</span>
                        {s.manually_reviewed && (
                          <span className="text-emerald-400">✓ reviewed</span>
                        )}
                      </div>
                      {s.trigger_signals.length > 0 && (
                        <div className="mt-1 flex items-center gap-1 flex-wrap">
                          {s.trigger_signals.map((sig) => (
                            <span
                              key={sig}
                              className="text-[8px] font-mono px-1 py-0.5 rounded bg-[var(--bg-overlay)] text-[var(--text-tertiary)]"
                            >
                              {sig}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {editing ? (
                    <>
                      <button
                        onClick={() => void saveEdit(s)}
                        disabled={rowBusy}
                        title="save"
                        aria-label="Save skill edit"
                        className="h-9 w-9 sm:h-6 sm:w-6 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 inline-flex items-center justify-center"
                      >
                        <Check size={10} aria-hidden />
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={rowBusy}
                        title="cancel"
                        aria-label="Cancel edit"
                        className="h-9 w-9 sm:h-6 sm:w-6 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-red-400 inline-flex items-center justify-center"
                      >
                        <X size={10} aria-hidden />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(s)}
                        disabled={rowBusy}
                        title="edit trigger + action"
                        aria-label="Edit trigger and action"
                        className="h-9 w-9 sm:h-6 sm:w-6 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/30 inline-flex items-center justify-center"
                      >
                        <Pencil size={10} aria-hidden />
                      </button>
                      {tab === "candidates" && (
                        <>
                          <button
                            onClick={() => act(s.key, "promote")}
                            disabled={rowBusy}
                            title="promote to active"
                            className="h-6 px-2 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-[9px] font-mono uppercase tracking-wider inline-flex items-center gap-1"
                          >
                            <ArrowUp size={9} />
                            promote
                          </button>
                          <button
                            onClick={() => act(s.key, "drop", "skill_pending")}
                            disabled={rowBusy}
                            title="drop candidate"
                            aria-label="Drop candidate"
                            className="h-9 w-9 sm:h-6 sm:w-6 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-red-400 hover:border-red-400/30 inline-flex items-center justify-center"
                          >
                            <Trash2 size={10} aria-hidden />
                          </button>
                        </>
                      )}
                      {tab === "active" && (
                        <>
                          <button
                            onClick={() => act(s.key, "graduate")}
                            disabled={rowBusy}
                            title="graduate (silent-track)"
                            className="h-6 px-2 rounded border border-violet-500/30 text-violet-400 hover:bg-violet-500/10 text-[9px] font-mono uppercase tracking-wider inline-flex items-center gap-1"
                          >
                            <GraduationCap size={9} />
                            graduate
                          </button>
                          <button
                            onClick={() => act(s.key, "drop", "skill")}
                            disabled={rowBusy}
                            title="drop skill"
                            aria-label="Drop skill"
                            className="h-9 w-9 sm:h-6 sm:w-6 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-red-400 hover:border-red-400/30 inline-flex items-center justify-center"
                          >
                            <Trash2 size={10} aria-hidden />
                          </button>
                        </>
                      )}
                      {tab === "graduated" && (
                        <button
                          onClick={() => act(s.key, "ungraduate")}
                          disabled={rowBusy}
                          title="back to active (resume nudging)"
                          className="h-6 px-2 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/30 text-[9px] font-mono uppercase tracking-wider"
                        >
                          un-grad
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {!loading && visible.length === 0 && (
          tab === "candidates" ? (
            <EmptyState
              icon={Target}
              title="No candidates yet"
              why="Candidates surface every Sunday at 3am from the last 30d of DONE tasks."
              unlock="Ship more tasks, or run the extractor now."
              cta={{ label: "Extract now", onClick: () => void extractNow(), disabled: extracting }}
              tone="neutral"
            />
          ) : tab === "active" ? (
            <EmptyState
              icon={CheckCircle2}
              title="No active skills yet"
              why="Active skills are candidates Nour has curated in the library. They track success_rate on every matching DONE task."
              unlock="Switch to the Candidates tab and Promote the patterns that ring true."
              tone="neutral"
            />
          ) : (
            <EmptyState
              icon={Eye}
              title="No graduated skills"
              why="Graduation means a skill is proven — Nick stops nudging but keeps the pattern on file for silent reference."
              unlock="Let active skills reinforce past 5 fires with high success_rate, then graduate them from the Active tab."
              tone="neutral"
            />
          )
        )}
      </div>

      <p className="text-[9px] text-[var(--text-tertiary)] mt-3 leading-relaxed">
        Candidates surface every Sunday at 3am from the last 30 days of DONE tasks.
        Active skills reinforce on matching completions — when success_rate stays high after 5+ fires,
        graduate them to silent-track so the system stops nudging but keeps the pattern on file.
      </p>
    </GlassCard>
  );
}
