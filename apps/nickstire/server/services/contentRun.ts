/**
 * The content run — one durable parent for a single "make me something" request.
 *
 * WHY THIS EXISTS
 * An operator asks for a post. Behind that sits a concept, an inventory row, maybe
 * a reel job, media assets, a QA verdict, an approval, and a publish attempt —
 * each correct on its own, none of them able to answer "what happened to the thing
 * I asked for at 9am". The operator currently holds that relationship in their
 * head. This holds it in a row.
 *
 * IT REFERENCES, IT DOES NOT REPLACE. Inventory, reel jobs and approvals keep
 * their own gates, hashes and provenance. Nothing here weakens a gate; this only
 * records which run those artifacts belong to.
 *
 * THE TWO-STATE MODEL IS THE POINT
 * `implementationState` = what was BUILT. `operationalState` = what was PROVEN in
 * production. They are separate columns because collapsing them is how a green
 * checkmark ends up over work that never happened — this codebase shipped an
 * override button that reported success while the publish was being refused, and
 * an audio gate that read "approve" from a stage that had never run. A run may
 * only claim `published` operationally when there is an igPostId to point at.
 */
import { randomUUID } from "crypto";
import { createLogger } from "../lib/logger";

const log = createLogger("services:content-run");

/** Where the run is. One vocabulary for every format. */
export const RUN_STAGE = {
  requested: "requested",
  planning: "planning",
  generating: "generating",
  assembling: "assembling",
  qa: "qa",
  awaiting_approval: "awaiting_approval",
  publishing: "publishing",
  done: "done",
  held: "held",
  failed: "failed",
} as const;
export type RunStage = (typeof RUN_STAGE)[keyof typeof RUN_STAGE];

/** What was BUILT. */
export const IMPLEMENTATION_STATE = {
  pending: "pending",
  built: "built",
  failed: "failed",
} as const;

/**
 * What was PROVEN. Deliberately narrow: `published` requires a real post id.
 * "We called the API and it did not throw" is `attempted`, not `published` —
 * that distinction is the entire publish-ambiguity problem in one field.
 */
export const OPERATIONAL_STATE = {
  unproven: "unproven",
  attempted: "attempted",
  published: "published",
  ambiguous: "ambiguous",
  failed: "failed",
} as const;

export type ImplementationState = (typeof IMPLEMENTATION_STATE)[keyof typeof IMPLEMENTATION_STATE];
export type OperationalState = (typeof OPERATIONAL_STATE)[keyof typeof OPERATIONAL_STATE];

// Every value must fit its column. `published_partial` (17 chars) once went into
// a varchar(16), was REJECTED under STRICT_TRANS_TABLES, and wedged rows — these
// columns are varchar(32), asserted here so a future rename cannot reintroduce it.
for (const [name, set] of Object.entries({ RUN_STAGE, IMPLEMENTATION_STATE, OPERATIONAL_STATE })) {
  for (const v of Object.values(set)) {
    if (v.length > 32) throw new Error(`${name} value "${v}" exceeds varchar(32)`);
  }
}

/** A single link in the evidence chain behind operationalState. */
export interface RunEvidence {
  at: string;
  what: string;
  /** Where a human can go and see it for themselves. */
  proof?: string | null;
}

export interface CreateRunInput {
  requestedBy?: string | null;
  requestSource?: "operator" | "planner" | "cron";
  requestedTopic?: string | null;
  /** Omit for "choose for me". */
  requestedFormat?: string | null;
}

export async function createContentRun(input: CreateRunInput): Promise<string | null> {
  const id = `run_${randomUUID()}`;
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new Error("no database");
    const { contentRuns } = await import("../../drizzle/schema");
    await d.insert(contentRuns).values({
      id,
      requestedBy: input.requestedBy ?? null,
      requestSource: input.requestSource ?? "operator",
      requestedTopic: input.requestedTopic ?? null,
      requestedFormat: input.requestedFormat ?? null,
      stage: RUN_STAGE.requested,
      implementationState: IMPLEMENTATION_STATE.pending,
      operationalState: OPERATIONAL_STATE.unproven,
      evidenceJson: JSON.stringify([{ at: new Date().toISOString(), what: "run requested" }]),
    });
    return id;
  } catch (err) {
    log.error("could not create content run", { err: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return null;
  }
}

/**
 * Advance a run, APPENDING to its evidence chain.
 *
 * Evidence is append-only on purpose: the chain is how an operator reconstructs
 * what actually happened, and an overwrite would erase the step that went wrong.
 */
export async function advanceContentRun(
  runId: string,
  patch: {
    stage?: RunStage;
    implementationState?: ImplementationState;
    operationalState?: OperationalState;
    chosenFormat?: string | null;
    formatReason?: string | null;
    objective?: string | null;
    thesis?: string | null;
    inventoryId?: string | null;
    reelJobId?: number | null;
    approvalId?: string | null;
    addCostCents?: number;
    failureReason?: string | null;
    evidence?: RunEvidence;
  },
): Promise<boolean> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new Error("no database");
    const { contentRuns } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");

    const [row] = await d.select().from(contentRuns).where(eq(contentRuns.id, runId)).limit(1);
    if (!row) {
      log.warn("advance on a run that does not exist", { runId });
      return false;
    }

    // A run may only claim `published` when something can be pointed at. Without
    // this guard the strongest state in the system is settable by assertion,
    // which is exactly the failure the two-state model exists to prevent.
    if (patch.operationalState === OPERATIONAL_STATE.published && !patch.evidence?.proof) {
      log.error("refusing to mark a run published without proof — use `attempted`", { runId });
      return false;
    }

    /**
     * The evidence chain is append-only, and this is a read-modify-write — two
     * concurrent advances both read the same chain and the second write erases
     * the first's entry. That is not theoretical here: render and stage can
     * overlap with the publish-side close, and losing an evidence row silently
     * removes the proof a later screen relies on.
     *
     * `chain = []` on a parse failure was the worse half: an unreadable chain
     * would be REPLACED by a single-entry one, converting a recoverable
     * corruption into permanent loss. A chain we cannot read is preserved
     * verbatim instead — the row keeps whatever it had, and only the new entry
     * is dropped, which is the direction that loses less.
     */
    let chain: RunEvidence[] = [];
    let chainReadable = true;
    try {
      const parsed = JSON.parse(row.evidenceJson ?? "[]");
      if (Array.isArray(parsed)) chain = parsed;
      else chainReadable = false;
    } catch {
      chainReadable = false;
    }
    if (!chainReadable) {
      log.warn("evidence chain unreadable — preserving it rather than overwriting", { runId });
    }
    if (patch.evidence && chainReadable) chain.push(patch.evidence);

    const set: Record<string, unknown> = {};
    if (chainReadable) set.evidenceJson = JSON.stringify(chain).slice(0, 16_000_000);
    for (const k of ["stage", "implementationState", "operationalState", "chosenFormat", "formatReason", "objective", "thesis", "inventoryId", "reelJobId", "approvalId", "failureReason"] as const) {
      if (patch[k] !== undefined) set[k] = patch[k];
    }
    if (patch.addCostCents) set.costCents = (row.costCents ?? 0) + patch.addCostCents;

    await d.update(contentRuns).set(set).where(eq(contentRuns.id, runId));
    return true;
  } catch (err) {
    log.error("could not advance content run", { runId, err: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return false;
  }
}

/**
 * Close the loop from the PUBLISH side, where the run id is not in hand.
 *
 * `operationalState` — the half of the two-state model that records what was
 * PROVEN in production — had no writer at all. Every run stopped at
 * `implementationState: built`, so a screen asking "did the thing I requested
 * this morning actually go live" could only ever answer "we made it".
 *
 * The publish paths do not carry a runId; they carry the inventory row the run
 * produced. `inventoryId` is the join, written at stage time, and this is the
 * reverse lookup — so the publisher does not need to know content runs exist
 * beyond calling this once.
 *
 * `proof` is REQUIRED by advanceContentRun for `published`, and that guard is
 * the whole point: the strongest state in the system must never be settable by
 * assertion. A publish with no post id is an `attempted`, not a `published` —
 * the same distinction the publish-attempt ledger draws, for the same reason.
 */
export async function markContentRunPublishedByInventory(
  inventoryId: string,
  args: { proof: string | null; what?: string },
): Promise<boolean> {
  if (!inventoryId) return false;
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return false;
    const { contentRuns } = await import("../../drizzle/schema");
    const { eq, desc } = await import("drizzle-orm");
    const [row] = await d
      .select({ id: contentRuns.id })
      .from(contentRuns)
      .where(eq(contentRuns.inventoryId, inventoryId))
      .orderBy(desc(contentRuns.createdAt))
      .limit(1);
    // No run behind this row is NORMAL — inventory predates content runs, and
    // plenty of rows are staged by paths that never opened one. Not an error.
    if (!row) return false;

    return await advanceContentRun(row.id, {
      // `done` means the run reached the end of its journey. Whether that journey
      // ENDED WELL is operationalState's job, not the stage's — a publish with no
      // post id is equally "done" and decidedly not "published".
      stage: RUN_STAGE.done,
      operationalState: args.proof ? OPERATIONAL_STATE.published : OPERATIONAL_STATE.attempted,
      evidence: {
        at: new Date().toISOString(),
        what: args.what ?? (args.proof ? "published to Instagram" : "publish attempted; no post id returned"),
        proof: args.proof,
      },
    });
  } catch (err) {
    // Recording must never be able to fail a publish that already happened.
    log.warn("could not close the content run for a published inventory row", {
      inventoryId,
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return false;
  }
}

/**
 * The operator-facing summary: what did I ask for, what did it decide, where is
 * it, and can I trust that it actually happened.
 */
export async function getContentRun(runId: string) {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return null;
  const { contentRuns } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await d.select().from(contentRuns).where(eq(contentRuns.id, runId)).limit(1);
  if (!row) return null;

  let evidence: RunEvidence[] = [];
  try { evidence = JSON.parse(row.evidenceJson ?? "[]"); } catch { /* an unreadable chain is still a run */ }

  return {
    ...row,
    evidence,
    // Stated once, here, so no screen has to re-derive it and get it wrong.
    isProvenPublished: row.operationalState === OPERATIONAL_STATE.published,
    needsOperator: row.stage === RUN_STAGE.held || row.stage === RUN_STAGE.awaiting_approval,
  };
}
