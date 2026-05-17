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
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { brainMemory } from "@/lib/brain/memory-manager";
import { ServiceError } from "@/lib/utils/service-error";

interface DismissBody {
  source?: string;
  text?: string;
  until?: "today" | "7d" | "forever";
}

function nudgeKey(source: string, text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
  return `${source}::${slug}`;
}

function expiryForUntil(until: DismissBody["until"]): Date | null {
  const now = Date.now();
  if (until === "today") {
    // Midnight ET tonight (rough 00:00 local)
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d;
  }
  if (until === "forever") return null;
  // default "7d"
  return new Date(now + 7 * 24 * 60 * 60 * 1000);
}

export const POST = apiHandler(
  async (req) => {
    const body = await readRequestJson<DismissBody>(req).catch(() => ({})) as DismissBody;
    const source = body.source;
    const text = body.text;
    if (!source || !text) throw new ServiceError("source and text required", 400);

    const key = nudgeKey(source, text);
    const expiresAt = expiryForUntil(body.until);

    await brainMemory.remember(
      "nudge_ack",
      key,
      `ACK: ${source} · ${text.slice(0, 120)}`,
      "nudge-dismiss",
      {
        source,
        text,
        until: body.until ?? "7d",
        ackAt: new Date().toISOString(),
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
    );

    return { ok: true, key, expiresAt: expiresAt?.toISOString() ?? null };
  },
  { auth: "owner" },
);
