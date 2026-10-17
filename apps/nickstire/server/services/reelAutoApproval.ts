/**
 * Auto-approval — the human-consent step recorded by POLICY instead of a tap.
 *
 * Operator instruction 2026-09-08: "Program it to auto approve all the reels."
 * Delivered as a switch, not a removed gate: `autonomy_policy.formatPermissions.reel`
 * already defines "auto" (schema: manual | approval_required | auto) and nothing
 * consumed it. When it is "auto", every ASSEMBLED reel with no live approval gets
 * one recorded through `recordReelApproval` — the same writer the Reel Queue's
 * button uses — so the row is attributable, expires, binds to the exact caption
 * bytes and asset digest, and re-runs the claim veto at the tap. Flip the policy
 * back to "approval_required" and this does nothing.
 *
 * WHAT THIS DOES NOT DO. It approves only `no_approval_recorded` and `approval_expired`.
 * A REVOKED approval is a human's no and stays a no (listReelPublishQueue reports
 * it as `approval_revoked`, not as "missing"). A reel whose Queue draft was
 * rejected, or is already published / publishing / ambiguous through another
 * door (`inventoryHold`), is never approved. Caption/asset drift after an
 * approval is what the binding exists to catch and is left for a human, with one
 * exception (F5, below): an asset changed BY A REPAIR is re-approved once its
 * re-QA is clean, the repair count is within the cap, and the caption is unchanged. A vetoed
 * reel is refused by the writer itself (content_vetoed). Every other publish gate —
 * rendered QA, originality, condemned script, disclosure — still runs after this.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:reel-auto-approval");

// Module-private on purpose: nothing outside this file reads it, so an `export` here is exactly
// the unconsumed-export shape the knip orphan gate exists to catch (and did, on every PR after #2217).
const AUTO_APPROVABLE_CODES = new Set(["no_approval_recorded", "approval_expired"]);

/**
 * F5 (operator decision 2026-10-13: "repaired reels AUTO-POST after a clean re-QA").
 * A repair re-renders the master, which voids the old approval with one of these
 * codes. They stay a human's call EXCEPT when the repair itself caused them: the
 * latest repair retired the render after the approval was recorded.
 */
const REPAIR_VOID_CODES = new Set(["video_changed_since_approval", "asset_bytes_changed_since_approval", "asset_digest_unverifiable"]);

type QueueEntry = Awaited<ReturnType<typeof import("./reelApproval").listReelPublishQueue>>["entries"][number];

/**
 * Why a REPAIRED reel may not be approved by policy, or null when it may. Runs for
 * every repaired reel auto-approval would approve, whatever its approval code:
 *   G3  repair attempts within the policy cap;
 *   G1  the verdict was computed after the repair retired the old render, and the
 *       gate reads it as `proceed` (read-only: this never runs QA or spends).
 * G2 is the caller's: only the repair-void codes and missing/expired reach here, and
 * recordReelApproval binds the fresh row to the current caption sha and mp4.
 */
async function repairedReelRefusal(e: QueueEntry, maxRepairAttempts: number): Promise<string | null> {
  const r = e.repair;
  if (!r) return null;
  if (r.attempts > maxRepairAttempts) return "repair_cap_exceeded";
  const replaced = Date.parse(String(r.lastReplacedAt ?? ""));
  const evaluated = Date.parse(String(r.verdictEvaluatedAt ?? ""));
  if (!Number.isFinite(replaced) || !Number.isFinite(evaluated) || evaluated <= replaced) return "repair_reqa_stale";
  try {
    const { evaluateReelPublishGate } = await import("./qualityGate");
    const g = await evaluateReelPublishGate(e.jobId, { runIfMissing: false });
    return g.allowed && g.gate === "proceed" ? null : "repair_reqa_not_clean";
  } catch {
    return "repair_reqa_unreadable";
  }
}

function repairedAfterApproval(e: QueueEntry): boolean {
  const replaced = Date.parse(String(e.repair?.lastReplacedAt ?? ""));
  const approved = e.approvedAt instanceof Date ? e.approvedAt.getTime() : Date.parse(String(e.approvedAt ?? ""));
  return Number.isFinite(replaced) && Number.isFinite(approved) && replaced > approved;
}

export interface AutoApprovalOutcome {
  policy: "auto" | "not_auto";
  considered: number;
  approved: number[];
  skipped: Array<{ jobId: number; why: string }>;
}

export async function autoApproveAssembledReels(limit = 25): Promise<AutoApprovalOutcome> {
  const { getActivePolicy } = await import("./autonomyControl");
  const policy = await getActivePolicy();
  if (policy.formatPermissions.reel !== "auto") {
    return { policy: "not_auto", considered: 0, approved: [], skipped: [] };
  }
  const { listReelPublishQueue, recordReelApproval, ReelApprovalWriteError } = await import("./reelApproval");
  // The drain posts the OLDEST approved reels first (id ASC), so read those too:
  // newest-first alone left the head of a long batch unapproved. Same codes and
  // vetoes below; this widens which rows are looked at, not what may be approved.
  const oldest = await listReelPublishQueue(limit, { oldestFirst: true });
  const newest = await listReelPublishQueue(limit);
  const seen = new Set<number>();
  const entries = [...oldest.entries, ...newest.entries].filter((e) => !seen.has(e.jobId) && !!seen.add(e.jobId));
  const out: AutoApprovalOutcome = { policy: "auto", considered: entries.length, approved: [], skipped: [] };
  const cap = Number(policy.limits?.maxRepairAttemptsPerAsset);
  // 2 is qualityGate's own fallback when the policy carries no cap.
  const maxRepairAttempts = Number.isInteger(cap) && cap >= 0 ? cap : 2;
  for (const e of entries) {
    if (e.vetoReason) { out.skipped.push({ jobId: e.jobId, why: "vetoed" }); continue; }
    if (e.inventoryHold) { out.skipped.push({ jobId: e.jobId, why: `inventory_${e.inventoryHold}` }); continue; }
    if (!e.approvalProblem) continue; // already approved — nothing to do
    const repairVoid = REPAIR_VOID_CODES.has(e.approvalProblem.code) && repairedAfterApproval(e);
    if (!AUTO_APPROVABLE_CODES.has(e.approvalProblem.code) && !repairVoid) {
      // revoked / caption changed / video changed / digest mismatch: a human's call
      out.skipped.push({ jobId: e.jobId, why: e.approvalProblem.code });
      continue;
    }
    const refusal = await repairedReelRefusal(e, maxRepairAttempts);
    if (refusal) { out.skipped.push({ jobId: e.jobId, why: refusal }); continue; }
    try {
      await recordReelApproval({
        jobId: e.jobId,
        approvedBy: `auto-approval:policy v${policy.version} (formatPermissions.reel=auto)`,
        expectedCaptionSha: e.captionSha,
        expectedVideoUrl: e.videoUrl,
        note: repairVoid
          ? "Recorded by policy after a repair and a clean re-QA of the repaired video (operator decision 2026-10-13). Every other publish gate still applies."
          : "Recorded by policy, not by a tap. Operator-authorized 2026-09-08. Every other publish gate still applies.",
      });
      out.approved.push(e.jobId);
    } catch (err) {
      const why = err instanceof ReelApprovalWriteError ? err.code : err instanceof Error ? err.message : String(err);
      out.skipped.push({ jobId: e.jobId, why });
    }
  }
  if (out.approved.length || out.skipped.length) {
    log.info("auto-approval pass", { approved: out.approved, skipped: out.skipped.slice(0, 10), considered: out.considered });
  }
  return out;
}
