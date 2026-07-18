/**
 * The ONE authorization a reel must pass to leave the building — whichever door
 * it uses.
 *
 * WHY THIS EXISTS
 * There were three doors to Instagram and three different ideas of what makes a
 * reel publishable:
 *   - dailyReelPost (cron) and the canary route both called evaluateReelPublishGate.
 *   - publishPost (the human Queue) ran eleven gates and never called it.
 *   - schedulePost ran the same eleven, never called it either, AND hashed the
 *     media URL *string* against an approval that stored a hash of the video
 *     BYTES — a comparison that cannot succeed.
 * Two of those doors had hand-copied the approval-integrity block, and the copies
 * had drifted. So the fix is not three patches; it is one function that every
 * door calls, with the duplication deleted rather than corrected in place.
 *
 * WHAT IT ENFORCES, in order:
 *   1. Approval integrity — via the canonical verifyApprovalRecord, which hashes
 *      BYTES for media and the raw string for the brief. No local re-implementation.
 *   2. Quality decision — via evaluateReelPublishGate, the same call the cron and
 *      canary already make. If rendered QA is unavailable, stale, or wants a
 *      repair, the human doors now see it instead of publishing past it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not consume an operator override. It returns the exact binding the
 * caller needs to consume one, because an override is an operator ACT that
 * belongs at the publish CAS, not inside a verification helper. An operator may
 * still publish over ADVISORY findings — that path is unchanged and intentional.
 * What they can no longer do is publish without the quality state being computed
 * and surfaced.
 */
import type { DB } from "../db";
import { createLogger } from "../lib/logger";
import { verifyApprovalRecord, describeApprovalFailure } from "./contentApprovals";

const log = createLogger("services:reelPublishAuthority");

export interface ReelAuthorizationInput {
  /** the socialContentInventory row being published */
  draft: { id: string; version: number; briefJson: string | null };
  /** the approved media URL, exactly as it will be handed to Meta */
  videoUrl: string;
}

export interface ReelAuthorization {
  /** Binding for an optional operator override, consumed by the caller at the publish CAS. */
  overrideBinding: {
    inventoryId: string;
    assetVersion: number;
    currentContentHash: string;
    currentBriefHash: string;
  };
  /** When the approval lapses (null = legacy pre-0087 record). */
  approvalExpiresAt: Date | null;
  /** The reel job the quality decision was read from, when one could be resolved. */
  reelJobId: number | null;
  /** Gate outcome, for logging and operator display. */
  gate: string;
}

/** Thrown when a reel may not publish. The message is operator-facing. */
export class ReelNotPublishableError extends Error {
  constructor(message: string, readonly gate: string) {
    super(message);
    this.name = "ReelNotPublishableError";
  }
}

/**
 * Find the reel job backing an inventory row.
 *
 * Two links exist and neither is a foreign key. `briefJson.reelJobId` is written
 * by the cron manufacturing path and is free to read — no query. Rows that predate
 * it fall back to reel_jobs.briefId, which holds the inventory id despite the name;
 * it is neither unique nor indexed, so the newest row wins deterministically.
 *
 * Returns null when neither resolves — MISSING EVIDENCE, never permission. What
 * the caller does with that is currently policy: see REEL_GATE_REQUIRE_JOB in
 * authorizeReelPublish. Measured on production, briefId resolved for only 2 of 8
 * recent jobs, so enforcement ships off until the link is backfilled.
 */
export async function resolveReelJobId(database: DB, draft: { id: string; briefJson: string | null }): Promise<number | null> {
  try {
    const brief = JSON.parse(draft.briefJson ?? "{}") as { reelJobId?: unknown };
    const id = Number(brief.reelJobId);
    if (Number.isInteger(id) && id > 0) return id;
  } catch {
    // Unparseable brief — fall through to the query. The approval check below
    // hashes the same string, so a corrupt brief fails there with a clearer message.
  }
  try {
    const { reelJobs } = await import("../../drizzle/schema");
    const { eq, desc } = await import("drizzle-orm");
    const rows = await database
      .select({ id: reelJobs.id })
      .from(reelJobs)
      .where(eq(reelJobs.briefId, draft.id))
      .orderBy(desc(reelJobs.id))
      .limit(1);
    return rows.length ? Number(rows[0].id) : null;
  } catch {
    return null;
  }
}


/**
 * May an operator override carry this particular refusal?
 *
 * NOT every refusal. An override means "I have seen these findings and accept
 * them", so it can only apply where there are findings to have seen:
 *
 *   - any BLOCK-severity finding  -> NEVER. That is the hard gate the whole
 *     override contract excludes (OVERRIDABLE_SEVERITIES = warn | repair).
 *   - unavailable / stale         -> NEVER. These mean the evidence is missing or
 *     describes a different file. There is nothing for the operator to have
 *     judged, and allowing it would re-open the fail-open this arc closed.
 *   - warn/repair findings only   -> allowed, if a valid override is bound to
 *     exactly this media.
 */
async function overrideMayProceed(
  database: DB,
  gate: { gate: string; findings: Array<{ severity?: string }> },
  binding: { inventoryId: string; assetVersion: number; currentContentHash: string; currentBriefHash: string },
): Promise<boolean> {
  if (gate.gate === "unavailable" || gate.gate === "stale") return false;
  if (!gate.findings.length) return false;
  if (gate.findings.some((f) => f.severity === "block")) return false;

  const { hasActiveOverride } = await import("./operatorOverride");
  const { present } = await hasActiveOverride(database, binding);
  return present;
}

/**
 * Authorize a reel publish, or throw ReelNotPublishableError.
 *
 * Fail-closed on everything it can prove: a bad approval, and any gate verdict
 * that is not "allowed" (unavailable, stale, needs_review, needs_paid_repair),
 * all stop the publish. Absence of evidence is not evidence of quality —
 * qualityGate.ts states the governing rule.
 *
 * ONE deliberate exception, flagged and logged: a draft whose reel job cannot be
 * resolved at all. That is enforced only under REEL_GATE_REQUIRE_JOB=true,
 * because the underlying link is measurably unreliable today. Do not read the
 * default as "safe" — read it as a known gap that is now loud instead of silent.
 */
export async function authorizeReelPublish(
  database: DB,
  input: ReelAuthorizationInput,
): Promise<ReelAuthorization> {
  const { draft, videoUrl } = input;

  // 1. Approval integrity — canonical, byte-hashing, one implementation.
  const verdict = await verifyApprovalRecord(database, {
    inventoryId: draft.id,
    // An approval is recorded against the version that was reviewed, which is the
    // version BEFORE the approval bumped the row.
    version: draft.version - 1,
    briefJson: draft.briefJson,
    mediaUrls: [videoUrl],
  });
  if (!verdict.ok) {
    throw new ReelNotPublishableError(describeApprovalFailure(verdict.reason), `approval_${verdict.reason}`);
  }

  // 2. Quality decision — the same authority the cron and canary already use.
  const reelJobId = await resolveReelJobId(database, draft);
  if (reelJobId === null) {
    // Doctrine says HOLD: no quality decision is not permission. But production
    // says the link is not yet reliable enough to enforce that — reel_jobs.briefId
    // is FREE TEXT, not a foreign key. Of 8 recent jobs only 2 pointed at a real
    // inventory row; the rest carry labels like "canary-1784346381850" and
    // "acceptance-b-battery". Enforcing today could refuse reels the operator can
    // currently publish.
    //
    // So the enforcement is real but OFF by default. Flipping REEL_GATE_REQUIRE_JOB
    // to "true" is an explicit operator act, to be taken once the link is
    // backfilled and one real Queue publish has been verified end to end. Until
    // then the gap is LOUD rather than silent — which is the actual defect being
    // fixed here; the old code did not even know the verdict existed.
    if (process.env.REEL_GATE_REQUIRE_JOB === "true") {
      throw new ReelNotPublishableError(
        "Cannot locate the reel job for this draft, so its rendered-QA verdict cannot be read. " +
          "Refusing to publish without a quality decision.",
        "unresolvable_job",
      );
    }
    log.warn(
      "reel publish proceeding WITHOUT a rendered-QA decision — no reel job resolves for this draft. " +
        "The approval-integrity gates still passed. Set REEL_GATE_REQUIRE_JOB=true to make this a hard stop.",
      { inventoryId: draft.id, assetVersion: draft.version - 1 },
    );
    return {
      overrideBinding: {
        inventoryId: draft.id,
        assetVersion: draft.version - 1,
        currentContentHash: verdict.mediaHash,
        currentBriefHash: verdict.briefHash,
      },
      approvalExpiresAt: verdict.expiresAt,
      reelJobId: null,
      gate: "job_unresolved",
    };
  }

  const { evaluateReelPublishGate } = await import("./qualityGate");
  const gate = await evaluateReelPublishGate(reelJobId);
  if (!gate.allowed) {
    // AN OPERATOR OVERRIDE IS HONOURED HERE, not 100 lines downstream at the
    // publish CAS. Consuming happens there; if this function throws first, the
    // consume is unreachable — which is exactly what happened: the Queue recorded
    // an override, retried, hit this same refusal, and told the operator it had
    // worked. The override was real and the publish still never happened.
    const binding = {
      inventoryId: draft.id,
      assetVersion: draft.version - 1,
      currentContentHash: verdict.mediaHash,
      currentBriefHash: verdict.briefHash,
    };
    if (await overrideMayProceed(database, gate, binding)) {
      log.warn("publish proceeding on an operator override of ADVISORY findings", {
        inventoryId: draft.id, gate: gate.gate, findings: gate.findings.length,
      });
      return { overrideBinding: binding, approvalExpiresAt: verdict.expiresAt, reelJobId, gate: `${gate.gate}_overridden` };
    }
    throw new ReelNotPublishableError(
      `Blocked by the rendered-QA gate (${gate.gate}): ${gate.reason}` +
        (gate.findings.length ? ` — ${gate.findings.length} finding(s) to resolve.` : ""),
      gate.gate,
    );
  }

  return {
    overrideBinding: {
      inventoryId: draft.id,
      assetVersion: draft.version - 1,
      currentContentHash: verdict.mediaHash,
      currentBriefHash: verdict.briefHash,
    },
    approvalExpiresAt: verdict.expiresAt,
    reelJobId,
    gate: gate.gate,
  };
}
