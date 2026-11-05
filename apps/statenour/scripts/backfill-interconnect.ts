/**
 * W13 backfill · job 2026-11-02-nour-os-interconnect · 2026-11-03 (Nour's go for the production write: 10:08 EST).
 *
 * Fills, once, what the interconnect waves cannot reach by code:
 *   orphan          the mission(s) "Plan it" made on 2026-11-02 ET with no goal: a goal id its phase-1 tasks
 *                   already carry, else the goal whose title it copied verbatim, else the missions rule below;
 *   missions        each live user mission with no goal -> the active goal its stored vector is nearest to, by the
 *                   linker's cosine over W8c's same-model vectors (lib/missions/suggest-goal.ts), only when the
 *                   best clears MIN_SCORE and beats the runner-up by MARGIN; word overlap is shown, never written;
 *   notes           the 2026-10-30 backfill contact rows still reading "interaction reported in chat (...)" -> one
 *                   line from his own messages naming the person in THAT row's conversation (chatSnippets).
 * Person ids on old journal entries (brain_dumps + reflections) are W8b's scripts/backfill-journal-person-ids.ts,
 * not a pass here (one implementation per write). Nothing here loads the fuzzy resolver or journal-link: the
 * resolver writes a people_intelligence_merge memory on any non-exact match.
 * No model call, no new rows, no ledger contact row, no lastInteraction move.
 *
 * The gate (scripts/people-backfill.ts shape; prod-db-guard: the 870-row dry run checked its flag after the delete):
 *   (default)  dry run: reads, prints counts and ids only, writes nothing. `--out <file>` also writes the plan to
 *              that LOCAL file (ids only) and prints its token, a short sha256 of the file.
 *   --execute --plan-file <file> --token <t>, with BACKFILL_EXECUTE=1: the file must hash to <t> (checked before
 *              Prisma loads); each pass copies its table to a _bak_ table in one REPEATABLE READ snapshot and
 *              refuses on a count mismatch; then writes exactly the file's rows, each a compare-and-swap on the
 *              state it was planned from. A receipt (ids only) lands in .completion/backfill-<pass>-<date>.json
 *              before the first write and again after the last; an older receipt is never overwritten.
 *   --revert <receipt> [--execute --token <t>]: undoes a receipt's rows that still hold what this backfill wrote.
 * Anything else (an unknown flag, --execute without BACKFILL_EXECUTE=1, its plan file or a matching token) exits 2
 * before any connection. Every write carries a marker: Mission.updatedBy = markerFor(pass) (one per link pass, so a
 * revert of one pass never touches the other's links); the ledger note's metadata gets noteVia + originalNote.
 * A lost row (it changed since the plan) is never forced: it is listed in the receipt with its reason and the run exits 1.
 *
 *   cd apps/statenour
 *   railway run -s statenour-web -- pnpm exec tsx scripts/backfill-interconnect.ts --pass all --out .completion/w13-plan.json
 *   $env:BACKFILL_EXECUTE='1'; railway run -s statenour-web -- pnpm exec tsx scripts/backfill-interconnect.ts --execute --plan-file .completion/w13-plan.json --token <t>
 */
import Module from "node:module";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

import { backupInOneSnapshot, fileToken, type BackupSource } from "@/lib/services/people/backfill-apply";
import { GENERIC_NOTE, isContactRow } from "@/lib/services/people/contact-rows";
import { isUserProject } from "@/lib/services/mission-helpers";
import { GOAL_EMBED_SOURCE_TYPE, SUGGEST_GOAL_MAX_GOALS, goalEmbedText } from "@/lib/missions/goal-embedding";
import { sanitizeForPrompt } from "@/lib/ai/prompt/sanitize";

export const MARKER = "backfill:2026-11-03";
export const NOTE_MARKER = "backfill-notes:2026-11-03";
/** Each link pass stamps its own Mission.updatedBy, so reverting one pass never undoes the other's link (round 1 P1). Longest 28 chars; the column is VarChar(64) (prisma/schema.prisma:243). */
export const markerFor = (pass: "orphan" | "missions") => `${MARKER}:${pass}`;
/** A link is written only at this cosine or above: the linker's auto-link bar. W8c's drawer suggests from 0.45 because he says yes there; here nobody does. */
export const MIN_SCORE = 0.55;
/** ...and only when the best goal beats the runner-up by this much. */
export const MARGIN = 0.05;
/** At most this many rows planned per pass per run; --limit only lowers it. */
export const PASS_CAP = 500;
/** Snippets per rewritten note, and the characters kept of each. */
export const NOTE_SNIPPETS = 3;
export const NOTE_SNIPPET_CHARS = 120;
const ORPHAN_DAY = "2026-11-02";
const GENERIC_PREFIX = "interaction reported in chat (";

export const PASS_ORDER = ["orphan", "missions", "notes"] as const;
export type PassName = (typeof PASS_ORDER)[number];

/** Each pass copies the one table it writes before its first write. */
const BACKUP: Record<PassName, { source: BackupSource; table: string }> = {
  orphan: { source: '"Mission"', table: "_bak_mission_w13_orphan_20261103" },
  missions: { source: '"Mission"', table: "_bak_mission_w13_missions_20261103" },
  notes: { source: "relationship_ledger", table: "_bak_relationship_ledger_w13_notes_20261103" },
};

type Db = Pick<PrismaClient, "mission" | "lifeGoal" | "vectorEmbedding" | "relationshipLedger">;
type FullDb = Db & Pick<PrismaClient, "$transaction" | "$disconnect">;
export type Snippets = (name: string, max: number, conversationId?: string, before?: Date) => Promise<string[]>;

export interface Skip {
  id: string;
  reason: string;
}
export interface LinkRow {
  missionId: string;
  lifeGoalId: string;
  priorUpdatedBy: string | null;
  basis: "task_goal" | "exact_title" | "embedding";
  score: number | null;
  /** Mission.updatedAt as the plan read it (ISO): the write swaps only while it is unchanged (claim-before-act). */
  updatedAt: string;
}
export interface NoteRow {
  ledgerId: string;
  /** Hash of the line the dry run built; the execute rebuilds it and writes only if it still matches. */
  noteSha: string;
}
type Row = LinkRow | NoteRow;
export interface Decision {
  missionId: string;
  basis: "embedding" | "words";
  decision: "link" | "list";
  reason?: string;
  goalId?: string;
  top: Array<{ goalId: string; score: number }>;
}
export interface PassPlan {
  pass: PassName;
  candidates: number;
  rows: Row[];
  skipped: Skip[];
  decisions?: Decision[];
  /** Printable lines: ids, scores and counts only. */
  lines: string[];
}
export interface PlanArgs {
  prisma: Db;
  now: Date;
  limit?: number;
  snippets?: Snippets;
}

const sfx = (id: string) => `…${id.slice(-6)}`;
/** The error code and the LAST non-empty line: a Prisma message opens with an empty line and carries the call's arguments (row text) in the middle. */
const msg = (err: unknown) => {
  const code = (err as { code?: unknown } | null)?.code;
  const last = (err instanceof Error ? err.message : String(err)).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  return `${typeof code === "string" ? `${code} ` : ""}${last}`.slice(0, 200);
};
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const countBy = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const keyOf = (pass: PassName, r: Row) => (pass === "notes" ? (r as NoteRow).ledgerId : (r as LinkRow).missionId);

export function effectiveCap(limit: number | undefined): number {
  return Math.min(limit ?? PASS_CAP, PASS_CAP);
}

export function etDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// ── arguments ─────────────────────────────────────────────────────────────────────────────────────

export function isExecute(argv: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return argv.includes("--execute") && env.BACKFILL_EXECUTE === "1";
}

export type Args =
  | { mode: "dry"; passes: PassName[]; limit?: number; out: string | null }
  | { mode: "execute"; passes: PassName[] | null; planFile: string; token: string }
  | { mode: "revert"; receipt: string; execute: boolean; token: string | null };

const VALUE_FLAGS = new Set(["--pass", "--limit", "--out", "--plan-file", "--token", "--revert"]);
const BARE_FLAGS = new Set(["--execute", "--dry-run"]);

export function parseArgs(argv: readonly string[]): Args {
  const v: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BARE_FLAGS.has(a)) continue;
    if (!VALUE_FLAGS.has(a)) throw new Error(`unknown argument ${a}`);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) throw new Error(`${a} needs a value`);
    v[a] = next;
    i++;
  }
  const execute = argv.includes("--execute");
  if (execute && argv.includes("--dry-run")) throw new Error("--execute and --dry-run together");
  const passes = (p: string | undefined): PassName[] | null => {
    if (p === undefined) return null;
    if (p === "all") return [...PASS_ORDER];
    if ((PASS_ORDER as readonly string[]).includes(p)) return [p as PassName];
    if (p === "journal-people") throw new Error("--pass journal-people is W8b's scripts/backfill-journal-person-ids.ts, not this script");
    throw new Error(`--pass must be one of ${PASS_ORDER.join("|")}|all`);
  };
  if (v["--revert"]) {
    if (execute && !v["--token"]) throw new Error("--revert --execute needs --token <the token its dry run printed>");
    return { mode: "revert", receipt: v["--revert"], execute, token: v["--token"] ?? null };
  }
  if (execute) {
    if (!v["--plan-file"]) throw new Error("--execute needs --plan-file <the file a dry run wrote with --out>");
    if (!v["--token"]) throw new Error("--execute needs --token <the token that dry run printed>");
    return { mode: "execute", passes: passes(v["--pass"]), planFile: v["--plan-file"], token: v["--token"] };
  }
  const ps = passes(v["--pass"]);
  if (!ps) throw new Error(`--pass <${PASS_ORDER.join("|")}|all> is required`);
  let limit: number | undefined;
  if (v["--limit"] !== undefined) {
    limit = Number(v["--limit"]);
    if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a whole number from 1");
  }
  return { mode: "dry", passes: ps, limit, out: v["--out"] ?? null };
}

// ── missions + orphan: score by W8c's stored same-model vectors ──────────────────────────────────

type Goal = { id: string; title: string; why: string | null };
interface Rank {
  basis: "embedding" | "words";
  ranked: Array<{ goalId: string; score: number }>;
  /** Why a words rank had no cosine: unparsable_vector, wrong_model, or no_comparable_embedding (no vector: the linker has not run). */
  why?: string;
}

/** Link only on an embedding score over MIN_SCORE that beats the runner-up by MARGIN. */
export function decide(r: Rank): { decision: "link"; goalId: string } | { decision: "list"; reason: string } {
  if (r.basis !== "embedding") return { decision: "list", reason: r.why ?? "no_comparable_embedding" };
  const [best, second] = r.ranked;
  if (!best) return { decision: "list", reason: "no_active_goals" };
  if (!(best.score >= MIN_SCORE)) return { decision: "list", reason: "below_threshold" };
  if (second && best.score - second.score < MARGIN) return { decision: "list", reason: "within_margin" };
  return { decision: "link", goalId: best.goalId };
}

/** null when the stored text is not a JSON array holding numbers: unparsable, counted and reasoned apart from "no vector". */
function parseVector(raw: string): number[] | null {
  try {
    const v: unknown = JSON.parse(raw);
    const nums = Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];
    return nums.length > 0 ? nums : null;
  } catch {
    return null;
  }
}

type MissionForRank = { id: string; title: string; successMetric: string | null; completionCriteria: unknown };

/**
 * W8c's rule (lib/missions/suggest-goal.ts): cosine only when EVERY active goal has a vector in the mission's model,
 * else word overlap for the whole rank. Ranked in full here because a write needs the runner-up for MARGIN, which
 * suggestGoalForMission (best only) does not return.
 */
async function goalRanker(db: Db, goals: Goal[], missionIds: string[]) {
  const { cosineSimilarity } = await import("@/lib/db/conversation-mission-linker");
  const { wordOverlapScore } = await import("@/lib/missions/suggest-goal");
  const rows = await db.vectorEmbedding.findMany({
    where: {
      OR: [
        { sourceType: "mission", sourceId: { in: missionIds } },
        { sourceType: GOAL_EMBED_SOURCE_TYPE, sourceId: { in: goals.map((g) => g.id) } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { sourceType: true, sourceId: true, embedding: true, model: true },
  });
  const read = rows.map((r) => ({ ...r, vec: parseVector(r.embedding) }));
  const unparsable = read.filter((r) => !r.vec).length;
  // The newest usable vector per goal per model, and every model a goal has any row in. A row with no model has no space.
  const goalVec = new Map<string, number[]>();
  const goalModels = new Map<string, Set<string>>();
  for (const r of read) {
    if (r.sourceType !== GOAL_EMBED_SOURCE_TYPE || r.model === null) continue;
    if (!goalModels.has(r.sourceId)) goalModels.set(r.sourceId, new Set());
    goalModels.get(r.sourceId)!.add(r.model);
    const k = `${r.model}\n${r.sourceId}`;
    if (r.vec && !goalVec.has(k)) goalVec.set(k, r.vec);
  }
  const ownOf = (id: string) => read.find((r) => r.sourceType === "mission" && r.sourceId === id);
  const mine = missionIds.map(ownOf).filter((r) => r !== undefined);
  const space = Object.entries(countBy(mine.flatMap((r) => (r.model ? [r.model] : [])))).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const goalsInSpace = space ? goals.filter((g) => goalVec.has(`${space}\n${g.id}`)).length : 0;
  const coverage = `  vectors · mission vectors ${mine.filter((r) => r.vec).length}/${missionIds.length} · goals with a vector in ${space ?? "no model"} ${goalsInSpace}/${goals.length} · unparsable ${unparsable}`;
  const rank = (m: MissionForRank): Rank => {
    const own = ownOf(m.id);
    const ownSpace = own?.model ?? null;
    const byScore = (xs: Array<{ goalId: string; score: number }>) =>
      xs.map((x) => ({ ...x, score: Number.isFinite(x.score) ? x.score : 0 })).sort((a, b) => b.score - a.score);
    const missing = own?.vec && ownSpace ? goals.filter((g) => !goalVec.has(`${ownSpace}\n${g.id}`)) : goals;
    if (own?.vec && ownSpace && goals.length > 0 && missing.length === 0) {
      const vec = own.vec;
      return { basis: "embedding", ranked: byScore(goals.map((g) => ({ goalId: g.id, score: cosineSimilarity(vec, goalVec.get(`${ownSpace}\n${g.id}`)!) }))) };
    }
    const why = !own
      ? "no_comparable_embedding"
      : !own.vec || (ownSpace !== null && missing.some((g) => goalModels.get(g.id)?.has(ownSpace)))
        ? "unparsable_vector"
        : ownSpace === null || missing.some((g) => (goalModels.get(g.id)?.size ?? 0) > 0)
          ? "wrong_model"
          : "no_comparable_embedding";
    const criteria = typeof m.completionCriteria === "string" ? m.completionCriteria : "";
    const text = [m.title, m.successMetric ?? "", criteria].join("\n");
    return { basis: "words", why, ranked: byScore(goals.map((g) => ({ goalId: g.id, score: wordOverlapScore(text, goalEmbedText(g)) }))) };
  };
  return { rank, coverage };
}

const activeGoals = (db: Db): Promise<Goal[]> =>
  db.lifeGoal.findMany({
    where: { status: "active", deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: SUGGEST_GOAL_MAX_GOALS,
    select: { id: true, title: true, why: true },
  });

/** The goal read is capped; at the cap, goals past it are never ranked, so say so. */
const capWarning = (goals: Goal[]) =>
  goals.length >= SUGGEST_GOAL_MAX_GOALS ? [`  warning: read ${goals.length} active goals = the cap ${SUGGEST_GOAL_MAX_GOALS}; any past it are not ranked`] : [];

const fmtTop = (top: Array<{ goalId: string; score: number }>) => top.map((t) => `${sfx(t.goalId)} ${t.score.toFixed(3)}`).join(" / ") || "-";

async function planMissions(a: PlanArgs): Promise<PassPlan> {
  const db = a.prisma;
  const missions = await db.mission.findMany({
    where: { deletedAt: null, lifeGoalId: null, status: { not: "KILLED" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, successMetric: true, completionCriteria: true, systemKind: true, updatedBy: true, updatedAt: true },
  });
  const goals = await activeGoals(db);
  const { rank, coverage } = await goalRanker(db, goals, missions.map((m) => m.id));
  const rows: LinkRow[] = [];
  const skipped: Skip[] = [];
  const decisions: Decision[] = [];
  const lines = [
    `  active goals ${goals.length} · min ${MIN_SCORE} · margin ${MARGIN}`,
    ...capWarning(goals),
    coverage,
    "  mission   goal      score  basis      decision",
  ];
  for (const m of missions) {
    if (!isUserProject(m)) {
      skipped.push({ id: m.id, reason: "inbox_or_anchor" });
      continue;
    }
    const r = rank(m);
    const d = decide(r);
    const top = r.ranked.slice(0, 2);
    decisions.push({ missionId: m.id, basis: r.basis, ...d, top });
    if (d.decision === "link") {
      rows.push({ missionId: m.id, lifeGoalId: d.goalId, priorUpdatedBy: m.updatedBy, basis: "embedding", score: top[0].score, updatedAt: m.updatedAt.toISOString() });
    } else {
      skipped.push({ id: m.id, reason: d.reason });
    }
    const best = top[0];
    lines.push(
      `  ${sfx(m.id)}  ${best ? sfx(best.goalId) : "-      "}  ${best ? best.score.toFixed(3) : "  -  "}  ${r.basis.padEnd(9)}  ${d.decision}${d.decision === "list" ? ` (${d.reason})` : ""}`,
    );
  }
  const left = decisions.filter((d) => d.decision === "list");
  if (left.length) {
    lines.push("  left unlinked for Nour (W8c's drawer picks), mission id: top two goal ids and scores");
    for (const d of left) lines.push(`    ${d.missionId}: ${d.top.map((t) => `${t.goalId} ${t.score.toFixed(3)}`).join(" / ") || "no active goal"} [${d.basis}]`);
  }
  return { pass: "missions", candidates: missions.length, rows, skipped, decisions, lines };
}

function firstPhaseName(planData: unknown): string | null {
  const phases = asObj(planData).phases;
  const name = Array.isArray(phases) ? asObj(phases[0]).name : null;
  return typeof name === "string" && name.trim() !== "" ? name : null;
}

async function planOrphan(a: PlanArgs): Promise<PassPlan> {
  const db = a.prisma;
  const missions = await db.mission.findMany({
    // A wide UTC window, then the exact ET day below (2026-11-02 is EST, UTC-5).
    where: {
      deletedAt: null,
      lifeGoalId: null,
      status: { not: "KILLED" },
      createdAt: { gte: new Date(`${ORPHAN_DAY}T00:00:00Z`), lt: new Date("2026-11-04T00:00:00Z") },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      successMetric: true,
      completionCriteria: true,
      systemKind: true,
      updatedBy: true,
      updatedAt: true,
      createdAt: true,
      planData: true,
      tasks: { where: { deletedAt: null }, select: { phaseName: true, goalId: true } },
    },
  });
  const goals = await activeGoals(db);
  const { rank, coverage } = await goalRanker(db, goals, missions.map((x) => x.id));
  // A task-carried goal is checked by id: activeGoals() is capped for ranking, and a live goal past the cap is still live.
  const taskGoalIds = [...new Set(missions.flatMap((m) => m.tasks.map((t) => t.goalId).filter((g): g is string => !!g)))];
  const liveTaskGoals = new Set(
    taskGoalIds.length
      ? (await db.lifeGoal.findMany({ where: { id: { in: taskGoalIds }, status: "active", deletedAt: null }, select: { id: true } })).map((g) => g.id)
      : [],
  );
  const rows: LinkRow[] = [];
  const skipped: Skip[] = [];
  const lines: string[] = [...capWarning(goals), coverage];
  for (const m of missions) {
    const skip = (reason: string) => {
      skipped.push({ id: m.id, reason });
      lines.push(`  ${m.id}: listed (${reason})`);
    };
    if (etDay(m.createdAt) !== ORPHAN_DAY) {
      skipped.push({ id: m.id, reason: `not_created_${ORPHAN_DAY}_et` });
      continue;
    }
    if (!isUserProject(m)) {
      skipped.push({ id: m.id, reason: "inbox_or_anchor" });
      continue;
    }
    const first = firstPhaseName(m.planData);
    // Plan it provenance in every case: a saved plan with a first phase (a bare zero-task project is not a Plan it mission).
    if (first === null) {
      skip("not_plan_it");
      continue;
    }
    if (!(m.tasks.length === 0 || m.tasks.every((t) => t.phaseName !== null && t.phaseName === first))) {
      skip("not_plan_it_shape");
      continue;
    }
    const taskGoals = [...new Set(m.tasks.map((t) => t.goalId).filter((g): g is string => !!g))];
    const titleHits = goals.filter((g) => g.title.trim() === m.title.trim());
    if (taskGoals.length > 1 || (taskGoals.length === 1 && titleHits.length > 0 && !titleHits.some((g) => g.id === taskGoals[0]))) {
      skip("task_goal_conflict");
      continue;
    }
    let pick: Pick<LinkRow, "lifeGoalId" | "basis" | "score"> | null = null;
    if (taskGoals.length === 1) {
      if (!liveTaskGoals.has(taskGoals[0])) {
        skip("task_goal_not_active");
        continue;
      }
      pick = { lifeGoalId: taskGoals[0], basis: "task_goal", score: null };
    } else if (titleHits.length === 1) {
      pick = { lifeGoalId: titleHits[0].id, basis: "exact_title", score: null };
    } else if (titleHits.length > 1) {
      skip("ambiguous_title");
      continue;
    } else {
      const r = rank(m);
      const d = decide(r);
      if (d.decision === "list") {
        skip(d.reason);
        lines.push(`    top two: ${fmtTop(r.ranked.slice(0, 2))} [${r.basis}]`);
        continue;
      }
      pick = { lifeGoalId: d.goalId, basis: "embedding", score: r.ranked[0].score };
    }
    rows.push({ missionId: m.id, priorUpdatedBy: m.updatedBy, updatedAt: m.updatedAt.toISOString(), ...pick });
    lines.push(`  ${sfx(m.id)} -> ${sfx(pick.lifeGoalId)} (${pick.basis}, ${m.tasks.length} tasks)`);
  }
  return { pass: "orphan", candidates: missions.length, rows, skipped, lines };
}

// ── notes ─────────────────────────────────────────────────────────────────────────────────────────

/** The one-line note: up to NOTE_SNIPPETS snippets, each clipped, on one line, fenced like every prompt-bound string. */
export function noteLine(snips: readonly string[]): string {
  return sanitizeForPrompt(
    snips
      .slice(0, NOTE_SNIPPETS)
      .map((s) => s.replace(/\s+/g, " ").trim().slice(0, NOTE_SNIPPET_CHARS).trim())
      .filter(Boolean)
      .join(" | "),
  );
}

type LedgerRead = { id: string; note: string; createdAt: Date; metadata: unknown; person: { name: string; deletedAt: Date | null } };

/** The same filter for the plan and the execute: a reason to leave the row, or the line to write. */
async function noteFor(r: LedgerRead, snippets: Snippets, genericNote: RegExp): Promise<{ reason: string } | { line: string }> {
  const meta = asObj(r.metadata);
  if (!genericNote.test(r.note)) return { reason: "not_generic" };
  if (!(typeof meta.via === "string" && meta.via.startsWith("backfill:"))) return { reason: "not_backfill" };
  if (meta.noteVia) return { reason: "already_noted" };
  if (!isContactRow({ metadata: r.metadata })) return { reason: "not_contact" };
  if (r.person.deletedAt) return { reason: "person_deleted" };
  if (typeof meta.conversationId !== "string" || meta.conversationId === "") return { reason: "no_conversation" };
  // At or before the row: the 2026-10-30 writer dated it at its digest window's last message (people-backfill.ts:172, :302).
  const line = noteLine(await snippets(r.person.name, NOTE_SNIPPETS, meta.conversationId, r.createdAt));
  return line ? { line } : { reason: "no_snippet" };
}

const LEDGER_SELECT = { id: true, note: true, createdAt: true, metadata: true, person: { select: { name: true, deletedAt: true } } } as const;

const defaultSnippets: Snippets = async (name, max, conversationId, before) =>
  (await import("@/lib/brain/people-intelligence")).chatSnippets(name, max, conversationId, before);

async function planNotes(a: PlanArgs): Promise<PassPlan> {
  const snippets = a.snippets ?? defaultSnippets;
  const ledger = await a.prisma.relationshipLedger.findMany({
    where: { note: { startsWith: GENERIC_PREFIX, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: LEDGER_SELECT,
  });
  const rows: NoteRow[] = [];
  const skipped: Skip[] = [];
  for (const r of ledger) {
    const n = await noteFor(r, snippets, GENERIC_NOTE);
    if ("reason" in n) skipped.push({ id: r.id, reason: n.reason });
    else rows.push({ ledgerId: r.id, noteSha: fileToken(n.line) });
  }
  const lines = skipped.filter((s) => s.reason === "no_snippet").map((s) => `  ${s.id}: left generic (no message of his names the person in that chat)`);
  return { pass: "notes", candidates: ledger.length, rows, skipped, lines };
}

const PLANNERS: Record<PassName, (a: PlanArgs) => Promise<PassPlan>> = {
  orphan: planOrphan,
  missions: planMissions,
  notes: planNotes,
};

/** Reads only. The cap is applied here, so the plan file never holds more than PASS_CAP rows per pass. */
export async function planPass(pass: PassName, a: PlanArgs): Promise<PassPlan> {
  const p = await PLANNERS[pass](a);
  const cap = effectiveCap(a.limit);
  return { ...p, rows: p.rows.slice(0, cap), skipped: [...p.skipped, ...p.rows.slice(cap).map((r) => ({ id: keyOf(pass, r), reason: "over_cap" }))] };
}

// ── execute: the plan file's rows, each a compare-and-swap ───────────────────────────────────────

type ApplyCtx = {
  snippets: Snippets;
  genericNote: RegExp;
  ledger: Map<string, LedgerRead>;
  liveGoals: Set<string>;
  /** An embedding link's planned goal still wins on today's vectors and goals (task-goal and exact-title links keep their own rule). */
  stillWins: (r: LinkRow) => boolean;
};

/** null when the row was written; otherwise the receipt's reason it was not (count !== 1 is a loss, never a retry). */
async function applyRow(db: Db, pass: PassName, row: Row, ctx: ApplyCtx): Promise<string | null> {
  if (pass === "orphan" || pass === "missions") {
    const r = row as LinkRow;
    if (!ctx.liveGoals.has(r.lifeGoalId)) return "goal_not_active";
    if (!ctx.stillWins(r)) return "ranking_changed";
    // Every field the plan's decision read: still unlinked, live, not KILLED, and unedited since (its vector is from that text).
    const res = await db.mission.updateMany({
      where: { id: r.missionId, lifeGoalId: null, deletedAt: null, status: { not: "KILLED" }, updatedAt: new Date(r.updatedAt) },
      data: { lifeGoalId: r.lifeGoalId, updatedBy: markerFor(pass) },
    });
    return res.count === 1 ? null : "swap_lost";
  }
  const r = row as NoteRow;
  const read = ctx.ledger.get(r.ledgerId);
  if (!read) return "ledger_row_gone";
  const n = await noteFor(read, ctx.snippets, ctx.genericNote);
  if ("reason" in n) return `no_note:${n.reason}`;
  if (fileToken(n.line) !== r.noteSha) return "snippet_changed";
  const res = await db.relationshipLedger.updateMany({
    where: { id: read.id, note: read.note },
    data: { note: n.line, metadata: { ...asObj(read.metadata), noteVia: NOTE_MARKER, originalNote: read.note } },
  });
  return res.count === 1 ? null : "swap_lost";
}

export interface PlanFile {
  job: "w13-backfill";
  generatedAt: string;
  passes: Partial<Record<PassName, Row[]>>;
}

export function parsePlanFile(contents: string): PlanFile {
  const raw = asObj(JSON.parse(contents));
  const passes = asObj(raw.passes);
  if (raw.job !== "w13-backfill") throw new Error("not a w13-backfill plan file");
  for (const [k, v] of Object.entries(passes)) {
    if (!(PASS_ORDER as readonly string[]).includes(k) || !Array.isArray(v)) throw new Error(`plan file pass ${k} is malformed`);
    for (const [i, r] of v.entries()) {
      const o = asObj(r);
      const ok =
        k === "notes"
          ? typeof o.ledgerId === "string" && typeof o.noteSha === "string"
          : typeof o.missionId === "string" &&
            typeof o.lifeGoalId === "string" &&
            typeof o.updatedAt === "string" &&
            Number.isFinite(Date.parse(o.updatedAt));
      if (!ok) throw new Error(`plan file ${k} row ${i} is malformed`);
    }
  }
  return raw as unknown as PlanFile;
}

export type ReceiptWriter = (payload: object) => string;

/**
 * Writes `.../backfill-<pass>-<ET date>.json`, or `-2`, `-3`... when one exists: an older receipt is never overwritten.
 * A rewrite goes to `<receipt>.tmp` and is renamed over it, so a crash or a full disk mid-write never truncates the
 * receipt a revert needs.
 */
export function makeReceiptWriter(dir: string, pass: PassName, now: Date): ReceiptWriter {
  let path: string | null = null;
  return (payload) => {
    const data = `${JSON.stringify(payload, null, 2)}\n`;
    if (path) {
      writeFileSync(`${path}.tmp`, data);
      renameSync(`${path}.tmp`, path);
      return path;
    }
    mkdirSync(dir, { recursive: true });
    for (let n = 1; ; n++) {
      const p = join(dir, `backfill-${pass}-${etDay(now)}${n === 1 ? "" : `-${n}`}.json`);
      try {
        writeFileSync(p, data, { flag: "wx" });
        path = p;
        return p;
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code !== "EEXIST") throw err;
      }
    }
  };
}

const receiptRow = (pass: PassName, r: Row) => (pass === "notes" ? { ledgerId: (r as NoteRow).ledgerId } : r);

/** ok false: the backup was refused and nothing was written. lost: rows the pass could not write (each with a reason in the receipt). */
async function executePass(
  db: FullDb,
  pass: PassName,
  rows: Row[],
  now: Date,
  writeReceipt: ReceiptWriter,
  snippets: Snippets,
): Promise<{ ok: boolean; lost: number }> {
  const { source, table } = BACKUP[pass];
  const backup = await backupInOneSnapshot(
    {
      inTransaction: (fn) =>
        db.$transaction(
          (tx) =>
            fn({
              exec: (sql) => tx.$executeRawUnsafe(sql),
              count: async (t) => Number(((await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${t}`)) as Array<{ n: number }>)[0].n),
            }),
          { isolationLevel: "RepeatableRead", timeout: 120_000 },
        ),
    },
    table,
    source,
  );
  if (backup.source === 0 || backup.source !== backup.backup) {
    console.log(`[${pass}] backup refused (source ${backup.source}, copy ${backup.backup}): nothing written`);
    return { ok: false, lost: 0 };
  }
  const base = { pass, marker: pass === "notes" ? NOTE_MARKER : markerFor(pass), backupTable: table, generatedAt: now.toISOString() };
  const planned = rows.map((r) => receiptRow(pass, r));
  // No written list until the run finishes: a receipt left "planned" by a dead process reverts nothing (round 2).
  const path = writeReceipt({ ...base, status: "planned", rows: planned });
  console.log(`[${pass}] receipt ${path} (planned ${rows.length})`);
  const written: string[] = [];
  const lost: Skip[] = [];
  let inFlight: string | null = null;
  let done = false;
  try {
    const ctx: ApplyCtx = { snippets, genericNote: /$^/, ledger: new Map(), liveGoals: new Set(), stillWins: () => true };
    if (pass === "notes") {
      ctx.genericNote = GENERIC_NOTE;
      const reads = await db.relationshipLedger.findMany({ where: { id: { in: rows.map((r) => (r as NoteRow).ledgerId) } }, select: LEDGER_SELECT });
      for (const r of reads) ctx.ledger.set(r.id, r);
    } else {
      // The plan required an active, undeleted goal; a goal paused or deleted since loses its rows.
      const links = rows as LinkRow[];
      const live = await db.lifeGoal.findMany({
        where: { id: { in: [...new Set(links.map((r) => r.lifeGoalId))] }, status: "active", deletedAt: null },
        select: { id: true },
      });
      ctx.liveGoals = new Set(live.map((g) => g.id));
      const { rank, coverage } = await goalRanker(db, await activeGoals(db), links.map((r) => r.missionId));
      console.log(coverage);
      ctx.stillWins = (r) => {
        // Fail closed: every missions-pass row is re-ranked; only an orphan's task-goal or exact-title link keeps its own rule.
        if (pass === "orphan" && (r.basis === "task_goal" || r.basis === "exact_title")) return true;
        // Only the cosine branch can pass decide(); the words text is never decisive, so an empty one stands in.
        const d = decide(rank({ id: r.missionId, title: "", successMetric: null, completionCriteria: null }));
        return d.decision === "link" && d.goalId === r.lifeGoalId;
      };
    }
    for (const r of rows) {
      inFlight = keyOf(pass, r);
      const why = await applyRow(db, pass, r, ctx);
      inFlight = null;
      if (why === null) written.push(keyOf(pass, r));
      else lost.push({ id: keyOf(pass, r), reason: why });
    }
    done = true;
  } finally {
    // A throw mid-loop still leaves the receipt naming what was written, and the row whose write threw (it may have landed).
    writeReceipt({ ...base, status: done ? "applied" : "aborted", rows: planned, written, lost, ...(done ? {} : { inFlight }) });
  }
  console.log(
    `[${pass}] backup ${table} (${backup.backup} rows) · written ${written.length} · lost ${lost.length} ${JSON.stringify(countBy(lost.map((l) => l.reason)))} · receipt ${path}`,
  );
  return { ok: true, lost: lost.length };
}

// ── revert ────────────────────────────────────────────────────────────────────────────────────────

type Receipt = ReturnType<typeof parseReceipt>;

/**
 * The receipt rows its own run wrote: the written list, plus an aborted run's in-flight row (that write may have
 * landed; the marker swap below finds out). null when the receipt never finished (no written list): nothing is known.
 */
function rowsToRevert(receipt: Receipt): Array<Record<string, unknown>> | null {
  if (!receipt.written) return null;
  const keys = new Set(receipt.written);
  if (receipt.inFlight) keys.add(receipt.inFlight);
  return receipt.rows.filter((r) => keys.has(keyOf(receipt.pass, r as unknown as Row)));
}

async function revertReceipt(db: Db, receipt: Receipt, rows: Array<Record<string, unknown>>): Promise<{ reverted: number; left: number }> {
  let reverted = 0;
  const done = (res: { count: number }) => (reverted += res.count);
  if (receipt.pass === "orphan" || receipt.pass === "missions") {
    for (const r of rows) {
      done(
        await db.mission.updateMany({
          where: { id: String(r.missionId), lifeGoalId: String(r.lifeGoalId), updatedBy: markerFor(receipt.pass) },
          data: { lifeGoalId: null, updatedBy: typeof r.priorUpdatedBy === "string" ? r.priorUpdatedBy : null },
        }),
      );
    }
  } else {
    const reads = await db.relationshipLedger.findMany({ where: { id: { in: rows.map((r) => String(r.ledgerId)) } }, select: { id: true, note: true, metadata: true } });
    for (const read of reads) {
      const { noteVia, originalNote, ...rest } = asObj(read.metadata);
      if (noteVia !== NOTE_MARKER || typeof originalNote !== "string") continue;
      done(await db.relationshipLedger.updateMany({ where: { id: read.id, note: read.note }, data: { note: originalNote, metadata: rest as object } }));
    }
  }
  return { reverted, left: rows.length - reverted };
}

function parseReceipt(contents: string) {
  const raw = asObj(JSON.parse(contents));
  if (!(PASS_ORDER as readonly string[]).includes(String(raw.pass)) || !Array.isArray(raw.rows)) throw new Error("not a backfill receipt");
  return {
    pass: raw.pass as PassName,
    rows: raw.rows.map(asObj),
    written: Array.isArray(raw.written) ? raw.written.map(String) : null,
    inFlight: typeof raw.inFlight === "string" ? raw.inFlight : null,
  };
}

const NEVER_FINISHED = "receipt never finished: re-run --revert after checking the rows by marker";

// ── main ──────────────────────────────────────────────────────────────────────────────────────────

function printPlan(p: PassPlan) {
  console.log(`\n[${p.pass}] candidates ${p.candidates} · planned ${p.rows.length} · skipped ${p.skipped.length} ${JSON.stringify(countBy(p.skipped.map((s) => s.reason)))}`);
  for (const l of p.lines) console.log(l);
}

/** Exit code: 0 done, 1 a refused backup, a lost row or a failure, 2 a refused command (nothing written). */
export async function main(argv: readonly string[], env: NodeJS.ProcessEnv, now: Date = new Date()): Promise<number> {
  // Everything that can refuse runs BEFORE the Prisma import: a refused command never opens a connection.
  let args: Args;
  let fileContents: string | null = null;
  try {
    args = parseArgs(argv);
    if (args.mode !== "dry" && !(args.mode === "revert" && !args.execute) && !isExecute(argv, env)) {
      throw new Error("--execute needs BACKFILL_EXECUTE=1 in the environment as well");
    }
    if (args.mode === "execute") {
      fileContents = readFileSync(args.planFile, "utf8");
      if (fileToken(fileContents) !== args.token) throw new Error(`the plan file hashes to ${fileToken(fileContents)}, not ${args.token}: run the dry run again`);
      parsePlanFile(fileContents);
    }
    if (args.mode === "revert") {
      fileContents = readFileSync(args.receipt, "utf8");
      parseReceipt(fileContents);
      if (args.execute && fileToken(fileContents) !== args.token) throw new Error(`the receipt hashes to ${fileToken(fileContents)}, not ${args.token}`);
    }
  } catch (err) {
    console.error(`refused: ${msg(err)}`);
    return 2;
  }

  let revertRows: Array<Record<string, unknown>> = [];
  if (args.mode === "revert") {
    const r = parseReceipt(fileContents!);
    const rows = rowsToRevert(r);
    if (!rows) {
      console.log(`revert · ${r.pass} · reverted 0 · left ${r.rows.length} · ${NEVER_FINISHED}`);
      return 1;
    }
    if (!args.execute) {
      console.log(
        `revert dry run · ${r.pass} · ${rows.length} of ${r.rows.length} receipt rows written by this run (only rows still holding the backfill's value are undone) · token ${fileToken(fileContents!)}`,
      );
      return 0;
    }
    revertRows = rows;
  }

  const { prisma } = await import("@/lib/prisma");
  const db = prisma as unknown as FullDb;
  try {
    if (args.mode === "revert") {
      const r = parseReceipt(fileContents!);
      const out = await revertReceipt(db, r, revertRows);
      console.log(
        `revert · ${r.pass} · reverted ${out.reverted} · left ${out.left} (changed since) · ${r.rows.length - revertRows.length} not written by this run`,
      );
      return 0;
    }
    if (args.mode === "dry") {
      console.log(`backfill-interconnect · dry run (writes nothing) · ${args.passes.join(", ")} · cap ${effectiveCap(args.limit)}`);
      const plan: PlanFile = { job: "w13-backfill", generatedAt: now.toISOString(), passes: {} };
      for (const pass of args.passes) {
        const p = await planPass(pass, { prisma: db, now, limit: args.limit });
        printPlan(p);
        plan.passes[pass] = p.rows;
      }
      if (args.passes.includes("orphan") && args.passes.includes("missions")) {
        console.log("\nnote: a mission planned by orphan can show in missions too; the execute writes it once (lifeGoalId must still be null).");
      }
      if (args.out) {
        const contents = JSON.stringify(plan);
        try {
          writeFileSync(args.out, contents, { flag: "wx" });
        } catch (err) {
          if ((err as { code?: unknown } | null)?.code !== "EEXIST") throw err;
          console.error(`refused: ${args.out} already exists; a plan file is never overwritten, pass a new --out path`);
          return 2;
        }
        console.log(`\nplan file ${args.out} · token ${fileToken(contents)}`);
      }
      return 0;
    }
    const plan = parsePlanFile(fileContents!);
    const passes = (args.passes ?? [...PASS_ORDER]).filter((p) => (plan.passes[p]?.length ?? 0) > 0);
    console.log(`backfill-interconnect · EXECUTE · plan ${args.planFile} · passes ${passes.join(", ") || "none with rows"}`);
    const dir = join(process.cwd(), ".completion");
    let lost = 0;
    for (const pass of passes) {
      const res = await executePass(db, pass, plan.passes[pass]!, now, makeReceiptWriter(dir, pass, now), defaultSnippets);
      if (!res.ok) return 1;
      lost += res.lost;
    }
    if (lost > 0) console.log(`\nlost ${lost} row(s): exit 1 (each receipt's lost list has the reason)`);
    return lost > 0 ? 1 : 0;
  } catch (err) {
    console.error(`failed: ${msg(err)}`);
    return 1;
  } finally {
    await db.$disconnect();
  }
}

if (/backfill-interconnect\.ts$/.test(process.argv[1] ?? "")) {
  // Same shim as scripts/people-backfill.ts: lazily loaded lib modules may import "server-only".
  const cjs = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => (request === "server-only" ? {} : original(request, parent, isMain));
  void main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code;
  });
}
