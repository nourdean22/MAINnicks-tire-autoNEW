/**
 * lib/brain/external-memory-intake.ts · 2026-09-01 audit P-1
 *
 * The production producer of `containsExternalContent: true`.
 *
 * Before this file existed the memory-quarantine control was a READER WITH
 * NO WRITER: tool-policy.ts:126 returns `require_memory_review` when a memory
 * write carries external content, guardian.ts files the content as a
 * MemoryInboxItem and /system/inbox renders the review queue — all built, all
 * tested, and the flag was set to `true` in exactly two places, both tests.
 * Meanwhile every ingestion cron wrote external content straight into
 * BrainMemory via `brainMemory.remember(...)`, never consulting the policy
 * layer at all. Recall then injected that content into the system prompt.
 *
 * This is the single door external content takes into memory. It goes
 * through `withGuardian("memory.pin")` — the SAME path an AI tool call takes
 * — so the policy engine, the quarantine, the contradiction check and the
 * dedupe are the production ones, not a copy. The guarded write below only
 * runs if the policy ever decides `allow` for external content; today it
 * never does, and that is the point: review changes WHEN a memory lands,
 * never WHERE (the inbox commit path reads `memoryTarget` back and writes
 * the exact category/key/source/metadata it would have had).
 *
 * Callers: app/api/cron/ingest-gmail (inbound mail). The other ingestion
 * crons (drive / calendar / reviews) still write directly — named in the
 * audit, not yet routed. Sent mail and Apple Notes are operator-authored and
 * stay direct: quarantining the operator's own words would be theatre.
 */
import { GuardianApprovalPendingError, withGuardian } from "@/lib/tools/guardian";
import { brainMemory } from "@/lib/brain/memory-manager";

export interface ExternalMemoryIntake {
  /** BrainMemory category the memory belongs in once reviewed. */
  category: string;
  /** BrainMemory key (idempotency key, e.g. `gmail_<messageId>`). */
  key: string;
  /** The external content itself — the thing that must not be trusted. */
  content: string;
  /** BrainMemory.source once committed (e.g. `gmail_cron`). */
  source: string;
  /** MemoryInboxItem.sourceType — shown in the review queue (e.g. `gmail_ingest`). */
  sourceType: string;
  /** MemoryInboxItem.sourceUrl — stable per-item id so re-runs can find the item. */
  sourceUrl: string;
  metadata?: Record<string, unknown>;
  privacyClass?: string;
}

export type ExternalMemoryIntakeOutcome =
  | { outcome: "quarantined"; inboxItemId: string }
  | { outcome: "committed" }
  | { outcome: "stored" };

/** What the guardian's quarantine branch reads off the payload. */
interface GuardedMemoryPayload extends ExternalMemoryIntake {
  containsExternalContent: true;
  memoryTarget: {
    category: string;
    key: string;
    source: string;
    metadata?: Record<string, unknown>;
  };
}

const guardedRemember = withGuardian(
  "memory.pin",
  async (p: GuardedMemoryPayload): Promise<{ pinned: true; committed?: boolean }> => {
    await brainMemory.remember(p.category, p.key, p.content, p.source, p.metadata);
    return { pinned: true };
  },
);

/**
 * Route one piece of external content into memory THROUGH the policy layer.
 * Never throws for the expected outcomes; a genuine failure (DB down, policy
 * deny) propagates so the caller's per-item error handling sees it.
 */
export async function intakeExternalMemory(
  input: ExternalMemoryIntake,
): Promise<ExternalMemoryIntakeOutcome> {
  try {
    const result = await guardedRemember({
      ...input,
      containsExternalContent: true,
      memoryTarget: {
        category: input.category,
        key: input.key,
        source: input.source,
        metadata: input.metadata,
      },
    });
    // guardian short-circuits an already-committed inbox item with
    // `{ committed: true }` instead of re-running the write.
    return result?.committed ? { outcome: "committed" } : { outcome: "stored" };
  } catch (err) {
    if (err instanceof GuardianApprovalPendingError) {
      return { outcome: "quarantined", inboxItemId: err.requestId };
    }
    throw err;
  }
}

/** Stable sourceUrl for a Gmail message — the inbox row's identity across cron runs. */
export function gmailSourceUrl(messageId: string): string {
  return `gmail://${messageId}`;
}
