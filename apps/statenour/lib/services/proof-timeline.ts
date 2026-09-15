/**
 * Repo Time Machine (2026-09-15): the proof lane's history, one row per
 * JUDGED commit, read back from the reality ledger.
 *
 * Every proof run posts `proof.run` (+ one `proof.episode_failed` per failed
 * episode) and, since the hidden holdout landed, `proof.holdout` — measured,
 * or explicitly UNMEASURED when the secret was absent. Each carries
 * `payload.liveCommit`: the commit nickstire.org actually served when it was
 * judged, which a push-triggered run can differ from (Railway still building).
 * Grouping on THAT sha, never the requested one, turns the ledger into a
 * timeline you can walk: which deploy first failed which episode, whether the
 * hidden holdout moved with the visible episodes, and the delta between
 * consecutive judged commits.
 *
 * `groupProofTimeline` is pure and tested; `proofTimeline` is the one ledger
 * read, with the same not-migrated degradation /proof already relies on.
 */
import { prisma } from "@/lib/prisma";
import { ledgerRead } from "@/lib/services/reality-ledger";

export const PROOF_TIMELINE_EVENT_TYPES = ["proof.run", "proof.holdout", "proof.episode_failed"] as const;

export interface TimelineEventLike {
  eventType: string;
  observedAt: Date | string;
  payload: unknown;
  objects?: unknown;
  sourceUri?: string | null;
}

export interface HoldoutCell {
  outcome: "success" | "failure" | "unmeasured" | "unknown";
  unexpected: number | null;
  total: number | null;
  failedIds: string[];
}

export interface ProofCommitRow {
  /** null = the run did not record which commit it judged (pre-2026-09-15 runs). */
  liveCommit: string | null;
  /** Latest observation grouped under this commit, ISO. */
  judgedAt: string;
  /** How many proof.run events this commit accumulated (daily + post-deploy). */
  runs: number;
  /** The latest run's verdict and counts. */
  runOutcome: string | null;
  expected: number | null;
  unexpected: number | null;
  /** Union of episode ids that failed on this commit, across its runs. */
  episodeFailures: string[];
  /** null = no proof.holdout event at all (older runs); "unmeasured" = the run said so. */
  holdout: HoldoutCell | null;
  runUrl: string | null;
  /** Against the previous (older) judged commit in the list. */
  deltas: {
    unexpected: number | null;
    holdoutUnexpected: number | null;
    newFailures: string[];
    fixedFailures: string[];
  };
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const at = (e: TimelineEventLike): number => new Date(e.observedAt).getTime();

function holdoutCell(payload: Rec): HoldoutCell {
  const outcome = payload.outcome;
  return {
    outcome: outcome === "success" || outcome === "failure" || outcome === "unmeasured" ? outcome : "unknown",
    unexpected: num(payload.unexpected),
    total: num(payload.total),
    failedIds: ids(payload.failedIds),
  };
}

function episodeIdOf(objects: unknown): string | null {
  if (!Array.isArray(objects)) return null;
  const o = objects.find((x) => rec(x).type === "episode");
  return o && typeof rec(o).id === "string" ? (rec(o).id as string) : null;
}

/** Newest judged commit first. Events may arrive in any order. */
export function groupProofTimeline(events: TimelineEventLike[], limit = 10): ProofCommitRow[] {
  const sorted = [...events].sort((a, b) => at(b) - at(a));
  const groups = new Map<string | null, TimelineEventLike[]>();
  for (const e of sorted) {
    const live = rec(e.payload).liveCommit;
    const key = typeof live === "string" && live.length > 0 ? live : null;
    const g = groups.get(key);
    if (g) g.push(e);
    else groups.set(key, [e]);
  }

  const rows: ProofCommitRow[] = [];
  for (const [liveCommit, es] of groups) {
    const runs = es.filter((e) => e.eventType === "proof.run");
    const latestRun = runs[0] ?? null;
    const run = rec(latestRun?.payload);
    const failures = new Set<string>();
    for (const r of runs) for (const id of ids(rec(r.payload).episodeFailures)) failures.add(id);
    for (const e of es) {
      if (e.eventType !== "proof.episode_failed") continue;
      const id = episodeIdOf(e.objects);
      if (id) failures.add(id);
    }
    const latestHoldout = es.find((e) => e.eventType === "proof.holdout") ?? null;
    rows.push({
      liveCommit,
      judgedAt: new Date(es[0].observedAt).toISOString(),
      runs: runs.length,
      runOutcome: typeof run.outcome === "string" ? run.outcome : null,
      expected: num(run.expected),
      unexpected: num(run.unexpected),
      episodeFailures: [...failures].sort(),
      holdout: latestHoldout ? holdoutCell(rec(latestHoldout.payload)) : null,
      runUrl: latestRun?.sourceUri ?? latestHoldout?.sourceUri ?? null,
      deltas: { unexpected: null, holdoutUnexpected: null, newFailures: [], fixedFailures: [] },
    });
  }

  // Deltas against the next-older row. A null on either side stays null: an
  // unmeasured holdout is not "zero failures", and a run that recorded no count
  // is not "no change".
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    const prev = rows[i + 1];
    if (!prev) continue;
    cur.deltas.unexpected = cur.unexpected !== null && prev.unexpected !== null ? cur.unexpected - prev.unexpected : null;
    const hc = cur.holdout?.outcome !== "unmeasured" ? cur.holdout?.unexpected ?? null : null;
    const hp = prev.holdout?.outcome !== "unmeasured" ? prev.holdout?.unexpected ?? null : null;
    cur.deltas.holdoutUnexpected = hc !== null && hp !== null ? hc - hp : null;
    const prevSet = new Set(prev.episodeFailures);
    const curSet = new Set(cur.episodeFailures);
    cur.deltas.newFailures = cur.episodeFailures.filter((id) => !prevSet.has(id));
    cur.deltas.fixedFailures = prev.episodeFailures.filter((id) => !curSet.has(id));
  }
  return rows.slice(0, limit);
}

/** Enough recent events to cover `limit` commits at a few runs each; the grouping does the rest. */
const EVENT_WINDOW = 400;

export async function proofTimeline(limit = 10) {
  const missing: string[] = [];
  const events = await ledgerRead(
    () =>
      prisma.realityEvent.findMany({
        where: { eventType: { in: [...PROOF_TIMELINE_EVENT_TYPES] } },
        orderBy: { observedAt: "desc" },
        take: EVENT_WINDOW,
        select: { eventType: true, observedAt: true, payload: true, objects: true, sourceUri: true },
      }),
    [] as TimelineEventLike[],
    missing,
  );
  return {
    /** false = the ledger tables are not migrated in this environment. */
    ledgerAvailable: missing.length === 0,
    commits: groupProofTimeline(events, limit),
    generatedAt: new Date().toISOString(),
  };
}
