/**
 * Blind pairwise review (2026-10-08): the operator's taste as a measurement.
 *
 * WHY. The independent judge (conceptTournament.judgeSingleConcept) gates every
 * live photo post, and nothing has ever asked whether the judge agrees with
 * the shop. The shadow-judge readout compares the judge with the generator's
 * SELF-eval — two models grading each other. The only ground truth is a
 * human looking at two finished posts and picking one, without seeing either
 * score. Ten blind picks say more about the judge than a hundred re-reads of
 * its rationale.
 *
 * HOW. Candidates are photo posts the judge actually scored (igAutopostLog
 * rows with an image and a shadowJudge total). A pair is the newest two not
 * yet compared; sides are assigned by a hash of the pair key so the newer
 * post is not always on the left. The pick is written to audit_log
 * (content.pairwise_pick, entity content_pair) with BOTH judge totals
 * snapshotted at pick time, so the agreement readout never needs a join and
 * cannot be rewritten by a later re-judge. No new table: an operator decision
 * is exactly what audit_log records.
 *
 * Pure parts (pairing, agreement, record parsing) are below the IO and tested
 * without a database.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:pairwise-review");

export interface PairCandidate {
  id: number;
  imageUrl: string;
  caption: string;
  /** The independent judge's total (0–100) at the time the post was made. */
  judgeTotal: number;
}

export interface BlindSide { id: number; imageUrl: string; caption: string }
export interface BlindPair { key: string; a: BlindSide; b: BlindSide }
export type PairPick = "a" | "b" | "tie";

export interface PickRecord {
  aId: number;
  bId: number;
  pick: PairPick;
  aJudge: number | null;
  bJudge: number | null;
}

export interface JudgeAgreement {
  picks: number;
  /** Picks where both judge totals exist, differ, and the pick was not a tie. */
  scored: number;
  agreed: number;
  disagreed: number;
  ties: number;
  /** agreed / scored, or null below 1 scored pick. */
  rate: number | null;
}

const PAIRWISE_ACTION = "content.pairwise_pick" as const;
const PAIRWISE_ENTITY = "content_pair" as const;

/** One key per unordered pair, so a pair is compared once however it was shown. */
function pairKey(aId: number, bId: number): string {
  return `${Math.min(aId, bId)}-${Math.max(aId, bId)}`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const MAX_CANDIDATES_SCANNED = 12;

/**
 * The newest two scored posts not yet compared, or null. Scans only the most
 * recent dozen so the operator compares current work, not the archive.
 */
export function nextBlindPair(candidates: PairCandidate[], pickedKeys: ReadonlySet<string>): BlindPair | null {
  const pool = candidates.slice(0, MAX_CANDIDATES_SCANNED);
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const key = pairKey(pool[i].id, pool[j].id);
      if (pickedKeys.has(key)) continue;
      // Side by hash: a fixed "newest on the left" would teach the operator
      // which side is newer and bias the pick.
      const [left, right] = hash(key) % 2 === 0 ? [pool[i], pool[j]] : [pool[j], pool[i]];
      const side = (c: PairCandidate): BlindSide => ({ id: c.id, imageUrl: c.imageUrl, caption: c.caption });
      return { key, a: side(left), b: side(right) };
    }
  }
  return null;
}

export function judgeAgreement(records: PickRecord[]): JudgeAgreement {
  const out: JudgeAgreement = { picks: records.length, scored: 0, agreed: 0, disagreed: 0, ties: 0, rate: null };
  for (const r of records) {
    if (r.pick === "tie") { out.ties++; continue; }
    if (r.aJudge == null || r.bJudge == null || r.aJudge === r.bJudge) continue;
    out.scored++;
    const judgePrefersA = r.aJudge > r.bJudge;
    if ((r.pick === "a") === judgePrefersA) out.agreed++;
    else out.disagreed++;
  }
  out.rate = out.scored ? out.agreed / out.scored : null;
  return out;
}

/** logAdminAction stores `metadata` under changes.metadata.new; read it back, strictly. */
export function pickRecordFromAuditChanges(changes: unknown): PickRecord | null {
  const m = (changes as { metadata?: { new?: Record<string, unknown> } } | null)?.metadata?.new;
  if (!m) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const aId = n(m.aId);
  const bId = n(m.bId);
  const pick = m.pick;
  if (aId == null || bId == null || (pick !== "a" && pick !== "b" && pick !== "tie")) return null;
  return { aId, bId, pick, aJudge: n(m.aJudge), bJudge: n(m.bJudge) };
}

// ─── IO ────────────────────────────────────────────────────────────────────

type Db = NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>;

/** Judged photo posts from the last 30 days, newest first. Throws on a failed read. */
export async function loadPairCandidates(d: Db): Promise<PairCandidate[]> {
  const { igAutopostLog } = await import("../../drizzle/schema");
  const { and, desc, gte, isNotNull } = await import("drizzle-orm");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await d
    .select({ id: igAutopostLog.id, imageUrl: igAutopostLog.imageUrl, caption: igAutopostLog.caption, scores: igAutopostLog.evalScoresJson })
    .from(igAutopostLog)
    .where(and(gte(igAutopostLog.createdAt, since), isNotNull(igAutopostLog.imageUrl)))
    .orderBy(desc(igAutopostLog.createdAt))
    .limit(60);
  const out: PairCandidate[] = [];
  for (const r of rows as Array<{ id: number; imageUrl: string | null; caption: string; scores: string | null }>) {
    if (!r.imageUrl) continue;
    try {
      const judge = (JSON.parse(r.scores ?? "{}") as { shadowJudge?: { total?: unknown } }).shadowJudge;
      if (typeof judge?.total !== "number") continue;
      out.push({ id: r.id, imageUrl: r.imageUrl, caption: r.caption, judgeTotal: judge.total });
    } catch {
      // a row whose scores do not parse was never judged as far as this review can tell
    }
  }
  return out;
}

/** Every pick ever recorded, newest first. Throws on a failed read. */
export async function loadPickRecords(d: Db): Promise<Array<PickRecord & { key: string }>> {
  const { auditLog } = await import("../../drizzle/schema");
  const { desc, eq } = await import("drizzle-orm");
  const rows = await d
    .select({ entityId: auditLog.entityId, changes: auditLog.changes })
    .from(auditLog)
    .where(eq(auditLog.action, PAIRWISE_ACTION))
    .orderBy(desc(auditLog.createdAt))
    .limit(500);
  const out: Array<PickRecord & { key: string }> = [];
  for (const r of rows as Array<{ entityId: string | null; changes: unknown }>) {
    const rec = pickRecordFromAuditChanges(r.changes);
    if (rec) out.push({ ...rec, key: r.entityId ?? pairKey(rec.aId, rec.bId) });
  }
  return out;
}

/**
 * Record a pick. The judge totals are re-read here, never taken from the
 * client, so the snapshot is what the judge actually said.
 */
export async function recordPairPick(
  d: Db,
  input: { aId: number; bId: number; pick: PairPick; actor: string },
): Promise<PickRecord> {
  const candidates = await loadPairCandidates(d);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const a = byId.get(input.aId);
  const b = byId.get(input.bId);
  if (!a || !b || input.aId === input.bId) throw new Error("that pair is not two current judged posts");
  const record: PickRecord = { aId: input.aId, bId: input.bId, pick: input.pick, aJudge: a.judgeTotal, bJudge: b.judgeTotal };
  const { logAdminAction } = await import("./auditTrail");
  await logAdminAction({
    action: PAIRWISE_ACTION,
    entityType: PAIRWISE_ENTITY,
    entityId: pairKey(input.aId, input.bId),
    details: `blind pick ${input.pick} (judge ${a.judgeTotal} vs ${b.judgeTotal})`,
    metadata: { ...record },
    actor: input.actor,
    actorType: "human_user",
  });
  log.info("pairwise pick recorded", { key: pairKey(input.aId, input.bId), pick: input.pick });
  return record;
}
