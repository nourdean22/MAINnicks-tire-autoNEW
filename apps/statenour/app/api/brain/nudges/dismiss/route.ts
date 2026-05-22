/**
 * POST /api/brain/nudges/dismiss — ACK a nudge.
 *
 * Nudges are computed freshly each request by computeNudges() from
 * several backing sources (BrainMemory rows for correlation-alert,
 * decision-drift, prediction-streak, blind-spot, identity axes, ghost
 * accuracy, pins, beliefs, etc). They're NOT stored as first-class
 * rows — so "dismissing" has to hit the source.
 *
 * Strategy: stamp a BrainMemory row with category="nudge_ack" and a
 * stable key derived from the nudge's {source, text}. The nudge
 * composer (computeNudges) filters out any nudge whose ack row is
 * newer than the underlying signal's updatedAt.
 *
 * Body: { source: NudgeSource, text: string, until?: "today"|"7d"|"forever" }
 *
 * Default `until` is "7d" — dismiss for a week unless re-upped by
 * a state change.
 *
 * Phase B.6d (2026-05-22 · legacy-modernizer REST→tRPC brain slice) ·
 * the inline ACK-row write moved to
 * `lib/brain/cross-system-nudge.dismissNudge` (alongside `computeNudges`
 * so the key derivation can't drift from the suppression filter) · this
 * route AND the new `trpc.brain.dismissNudge` procedure call the same
 * function · drift impossible.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { dismissNudge } from "@/lib/brain/cross-system-nudge";
import { ServiceError } from "@/lib/utils/service-error";

interface DismissBody {
  source?: string;
  text?: string;
  until?: "today" | "7d" | "forever";
}

export const POST = apiHandler(
  async (req) => {
    const body = (await readRequestJson<DismissBody>(req).catch(
      () => ({}),
    )) as DismissBody;
    const source = body.source;
    const text = body.text;
    if (!source || !text) {
      throw new ServiceError("source and text required", 400);
    }
    return dismissNudge({ source, text, until: body.until });
  },
  { auth: "owner" },
);
