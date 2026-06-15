/**
 * lib/services/chat-lane-check.ts · Phase GG (2026-05-18 PM)
 *
 * Real-time lane correction service · powers the
 * LaneCorrectionChip "Also watching: …" surface that appears below
 * assistant replies in /chat. Reads cached blind-spot detector +
 * Dania silence signal · session-dedupes per domain · returns at
 * most one chip per call.
 *
 * Extracted from `app/api/ai/chat/lane-check/route.ts` so the legacy
 * REST endpoint AND the new `trpc.chat.laneCheck` procedure both
 * call this single function · drift between the two consumers is
 * structurally impossible. Same shared-service pattern as S.2 / U.3 /
 * Y.1 / Z / DD / EE.
 *
 * NOTE · the 30-min session dedupe lives in this module's RECENT_CHIPS
 * in-memory Map · survives within a lambda instance but resets on cold
 * start. That's the same behavior the legacy route had · intentional ·
 * a fresh lambda after a deploy should re-surface chips for the
 * operator's next conversation regardless of pre-deploy dedupe state.
 */

import { prisma } from "@/lib/prisma";
import { detectBlindSpots, type BlindSpot } from "@/lib/brain/blind-spot-detector";
import { cached } from "@/lib/utils/cache";
import { daysAgo } from "@/lib/utils/datetime";
import { getUrgentLeads } from "@/lib/services/leads";

export interface LaneChip {
  domain: string;
  text: string;
  action: string;
  href: string;
  severity: BlindSpot["severity"];
}

export interface LaneCheckArgs {
  userMessage: string;
  assistantMessage: string;
}

export interface LaneCheckResult {
  chip: LaneChip | null;
  /** Optional reason · "session_dedup" when suppressed by the
   *  30-min dedupe window. */
  reason?: string;
}

const RECENT_CHIPS = new Map<string, { at: number; domain: string }>();
const RECENT_CHIP_WINDOW_MS = 30 * 60_000; // 30 min

// Words that give us domain signal. Ordered by specificity so the
// first match wins.
const DOMAIN_TOKENS: Array<{ domain: string; tokens: RegExp }> = [
  { domain: "body", tokens: /\b(workout|gym|sleep|food|health|energy|weight|hrv|mood)\b/i },
  { domain: "money", tokens: /\b(revenue|pipeline|invoice|quote|job|margin|cash|expense|payroll)\b/i },
  { domain: "lead", tokens: /\b(lead|prospect|customer|contact|follow[- ]?up|call|missed[- ]?call)\b/i },
  { domain: "inventory", tokens: /\b(tire|sku|stock|inventory|shipment|vendor|michelin|bridgestone|b2b)\b/i },
  { domain: "marriage", tokens: /\b(dania|wife|marriage|date[- ]?night|fertility|ivf)\b/i },
  { domain: "systems", tokens: /\b(system|automation|brain|prompt|code|nickstire|autonicks|vercel|railway)\b/i },
  { domain: "strategy", tokens: /\b(plan|strategy|vision|mission|goal|forecast|quarterly)\b/i },
  { domain: "mind", tokens: /\b(reflect|drift|journal|commitment|pattern|habit|discipline)\b/i },
];

function inferDomain(text: string): string | null {
  for (const { domain, tokens } of DOMAIN_TOKENS) {
    if (tokens.test(text)) return domain;
  }
  return null;
}

const HREF_BY_DOMAIN: Record<string, string> = {
  body: "/stats#body",
  money: "/business?tab=money",
  lead: "/missions",
  inventory: "/inventory",
  marriage: "/journal",
  systems: "/system",
  strategy: "/strategy",
  mind: "/brain",
};

export async function checkLane(args: LaneCheckArgs): Promise<LaneCheckResult> {
  const userMsg = (args.userMessage ?? "").trim();
  const assistantMsg = (args.assistantMessage ?? "").trim();
  if (!userMsg || !assistantMsg || assistantMsg.length < 40) {
    return { chip: null };
  }

  const currentDomain = inferDomain(`${userMsg} ${assistantMsg}`);

  // Session dedupe — don't show the same domain chip twice within 30 min
  const dedupeKey = `any::${currentDomain || "global"}`;
  const recent = RECENT_CHIPS.get(dedupeKey);
  if (recent && Date.now() - recent.at < RECENT_CHIP_WINDOW_MS) {
    return { chip: null, reason: "session_dedup" };
  }

  // Pull blind spots + a lightweight "domain last touched" signal.
  // Both go through the shared 2-min cache so the lane-check
  // endpoint doesn't hammer the detector.
  // detectBlindSpots() is a global signal — it takes NO args. Keying
  // the cache on (userMsg, assistantMsg) gave every turn a unique key,
  // so the 120s cache never deduped and the detector ran on every turn.
  // A fixed key lets consecutive turns share the cached result.
  const blindSpots = await cached(
    "lane_check_blind_spots",
    120,
    async () => detectBlindSpots().catch((): BlindSpot[] => []),
  );

  // Surface the highest-severity adjacent (non-current-domain) blind spot.
  let chip: LaneChip | null = null;

  if (blindSpots.length > 0) {
    const urgentLeads = await getUrgentLeads().catch(() => []);
    const hasUrgentLeads = urgentLeads.length > 0;

    const adjacent = blindSpots
      .filter((b) => !currentDomain || b.domain.toLowerCase() !== currentDomain)
      .filter((b) => {
        if (hasUrgentLeads) {
          const personalDomains = ["body", "marriage", "relationships", "family", "spiritual", "health", "mental", "mind", "general"];
          return !personalDomains.includes(b.domain.toLowerCase());
        }
        return true;
      })
      .sort((a, b) => {
        const sev = { critical: 0, high: 1, medium: 2, low: 3 };
        return sev[a.severity] - sev[b.severity];
      })[0];
    if (adjacent && (adjacent.severity === "critical" || adjacent.severity === "high")) {
      chip = {
        domain: adjacent.domain,
        text: `Also watching: ${adjacent.description.slice(0, 60)}`,
        action: adjacent.suggestedAction.slice(0, 30),
        href: HREF_BY_DOMAIN[adjacent.domain.toLowerCase()] || "/strategy",
        severity: adjacent.severity,
      };
    }
  }

  if (!chip) return { chip: null };

  // Record for session dedupe + simple GC of stale entries
  RECENT_CHIPS.set(dedupeKey, { at: Date.now(), domain: chip.domain });
  if (RECENT_CHIPS.size > 30) {
    const cutoff = Date.now() - 2 * RECENT_CHIP_WINDOW_MS;
    for (const [k, v] of RECENT_CHIPS.entries()) {
      if (v.at < cutoff) RECENT_CHIPS.delete(k);
    }
  }

  return { chip };
}

/**
 * Phase B.5 (2026-05-22) · record a lane-correction chip tap/dismiss.
 *
 * Extracted from `app/api/ai/chat/lane-check/feedback/route.ts` so the
 * legacy REST endpoint AND the new `trpc.chat.laneCheckFeedback`
 * mutation both call this single function · drift impossible. Folded
 * into this module (rather than a new file) because it's the write
 * side of the same lane-check feature `checkLane` above serves.
 *
 * Writes a SystemMetric row (metric="lane.chip.feedback", value=1
 * on tap / 0 on dismiss, tags={action, domain, severity, msgHash}).
 * NON-FATAL by contract · the Prisma write is `.catch(() => {})` and
 * any thrown error is swallowed to a `{ ok: true }` — feedback
 * telemetry must never break the chip UI. The legacy route mirrors
 * this by returning HTTP 200 even on failure.
 */
export interface LaneCheckFeedbackArgs {
  action: "tapped" | "dismissed";
  domain: string;
  severity?: string;
  userMessage?: string;
  assistantMessage?: string;
}

export async function recordLaneCheckFeedback(
  args: LaneCheckFeedbackArgs,
): Promise<{ ok: true }> {
  try {
    const msgSample =
      (args.userMessage || "").slice(-80) +
      "|" +
      (args.assistantMessage || "").slice(-80);
    let h = 0;
    for (let i = 0; i < msgSample.length; i++) {
      h = (h * 31 + msgSample.charCodeAt(i)) | 0;
    }
    const msgHash = String(h);

    await prisma.systemMetric
      .create({
        data: {
          metric: "lane.chip.feedback",
          value: args.action === "tapped" ? 1 : 0,
          unit: "bool",
          source: "api",
          tags: {
            action: args.action,
            domain: args.domain,
            severity: args.severity || "unknown",
            msgHash,
          } as Parameters<typeof prisma.systemMetric.create>[0]["data"]["tags"],
        },
      })
      .catch(() => {});
  } catch {
    // Telemetry can't break a user action · swallow.
  }
  return { ok: true };
}
