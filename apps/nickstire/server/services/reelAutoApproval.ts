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
 * A REVOKED approval is a human's no and stays a no. Caption/asset drift after an
 * approval is what the binding exists to catch and is left for a human. A vetoed
 * reel is refused by the writer itself (content_vetoed). Every other publish gate —
 * rendered QA, originality, condemned script, disclosure — still runs after this.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:reel-auto-approval");

// Module-private on purpose: nothing outside this file reads it, so an `export` here is exactly
// the unconsumed-export shape the knip orphan gate exists to catch (and did, on every PR after #2217).
const AUTO_APPROVABLE_CODES = new Set(["no_approval_recorded", "approval_expired"]);

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
  const { entries } = await listReelPublishQueue(limit);
  const out: AutoApprovalOutcome = { policy: "auto", considered: entries.length, approved: [], skipped: [] };
  for (const e of entries) {
    if (e.vetoReason) { out.skipped.push({ jobId: e.jobId, why: "vetoed" }); continue; }
    if (!e.approvalProblem) continue; // already approved — nothing to do
    if (!AUTO_APPROVABLE_CODES.has(e.approvalProblem.code)) {
      // revoked / caption changed / video changed / digest mismatch: a human's call
      out.skipped.push({ jobId: e.jobId, why: e.approvalProblem.code });
      continue;
    }
    try {
      await recordReelApproval({
        jobId: e.jobId,
        approvedBy: `auto-approval:policy v${policy.version} (formatPermissions.reel=auto)`,
        expectedCaptionSha: e.captionSha,
        expectedVideoUrl: e.videoUrl,
        note: "Recorded by policy, not by a tap. Operator-authorized 2026-09-08. Every other publish gate still applies.",
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
