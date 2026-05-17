import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { detectBlindSpots, type BlindSpot } from "@/lib/brain/blind-spot-detector";
import { cached } from "@/lib/utils/cache";
import { daysAgo } from "@/lib/utils/datetime";

import { requireSession } from "@/lib/auth-guard";
export const runtime = "nodejs";
export const maxDuration = 10;

/**
 * POST /api/ai/chat/lane-check
 *
 * Real-time lane correction for the chat surface. Nour called out
 * that the HQ "situation" summary is passive — he wanted proactive
 * blind-spot watching + lane correction inline during the actual
 * conversation. This is that.
 *
 * Flow:
 *   chat page finishes rendering an assistant reply
 *   → POST { userMessage, assistantMessage, conversationDomain? }
 *   ← { chip } where chip is null (nothing to flag) OR a small
 *     "Also consider: [Y]" one-liner with a deep-link.
 *
 * Logic (no AI, all rule-based for speed):
 *   1. Extract query tokens (domain hints) from user message
 *   2. Load cached blind-spot set (already computed by /ultron/situation
 *      infra — reuses the same cache key)
 *   3. Find a blind spot whose domain is adjacent but NOT directly
 *      covered by the current conversation. That's the "also consider"
 *      surface.
 *   4. Skip if we've already surfaced this chip in the last 30 min
 *      (session-sticky dedupe via a simple in-memory window).
 *
 * Response shape:
 *   {
 *     chip: null | {
 *       domain: string;
 *       text: string;             // "You haven't checked inventory in 5d"
 *       action: string;           // "pull counts"
 *       href: string;             // "/inventory" or "/tasks?focus=X"
 *       severity: "medium" | "high" | "critical";
 *     }
 *   }
 *
 * Cached by (userMsg hash + assistant hash) for 2 min per lambda so
 * rapid re-renders don't re-run the blind-spot query.
 */

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

function hashKey(a: string, b: string): string {
  const raw = `${a.slice(-200)}||${b.slice(-300)}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return String(h);
}

function inferDomain(text: string): string | null {
  for (const { domain, tokens } of DOMAIN_TOKENS) {
    if (tokens.test(text)) return domain;
  }
  return null;
}

interface LaneChip {
  domain: string;
  text: string;
  action: string;
  href: string;
  severity: BlindSpot["severity"];
}

export async function POST(req: NextRequest) {
  await requireSession(req);
  try {
    const body = await req.json();
    const userMsg = String(body?.userMessage || "").trim();
    const assistantMsg = String(body?.assistantMessage || "").trim();
    if (!userMsg || !assistantMsg || assistantMsg.length < 40) {
      return NextResponse.json({ chip: null });
    }

    const currentDomain = inferDomain(`${userMsg} ${assistantMsg}`);

    // Session dedupe — don't show the same domain chip twice within 30 min
    const dedupeKey = `any::${currentDomain || "global"}`;
    const recent = RECENT_CHIPS.get(dedupeKey);
    if (recent && Date.now() - recent.at < RECENT_CHIP_WINDOW_MS) {
      return NextResponse.json({ chip: null, reason: "session_dedup" });
    }

    // Pull blind spots + a lightweight "domain last touched" signal.
    // Both go through the shared 2-min cache so the lane-check
    // endpoint doesn't hammer the detector.
    const [blindSpots, daniaLastMention] = await cached(
      hashKey(userMsg, assistantMsg),
      120,
      async () => {
        const bs = await detectBlindSpots().catch((): BlindSpot[] => []);
        // Special case: Dania silence is a permanent watched domain
        // per Nour's permanent rules — check even if not in blind spots
        const daniaMention = await prisma.chatMessage
          .findFirst({
            where: {
              role: "user",
              content: { contains: "Dania", mode: "insensitive" },
              createdAt: { gte: daysAgo(30) },
            },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          })
          .catch(() => null);
        return [bs, daniaMention] as const;
      }
    );

    // Pick the best blind spot to surface:
    //   1. If current conversation domain has a direct blind spot → skip
    //      (Nick already covered it in-line; adding a chip would be noise)
    //   2. If there's a blind spot in an ADJACENT domain (related but not
    //      what Nour is currently asking about) → that's the chip
    //   3. Prefer critical > high > medium severity
    //   4. Always consider: dania silence > 7d as a special override
    let chip: LaneChip | null = null;

    // Dania silence override
    if (daniaLastMention) {
      const silenceDays = Math.floor(
        (Date.now() - daniaLastMention.createdAt.getTime()) / 86400_000
      );
      if (silenceDays >= 7 && currentDomain !== "marriage") {
        chip = {
          domain: "marriage",
          text: `Dania silent ${silenceDays}d — surface gently?`,
          action: "reflect",
          href: "/journal",
          severity: "medium",
        };
      }
    } else if (currentDomain !== "marriage") {
      // No Dania mentions in 30d at all — that's the red-line condition
      chip = {
        domain: "marriage",
        text: `No Dania mentions in 30d — surface this carefully`,
        action: "reflect",
        href: "/journal",
        severity: "high",
      };
    }

    if (!chip && blindSpots.length > 0) {
      // Pick the highest-severity blind spot NOT in current domain
      const adjacent = blindSpots
        .filter((b) => !currentDomain || b.domain.toLowerCase() !== currentDomain)
        .sort((a, b) => {
          const sev = { critical: 0, high: 1, medium: 2, low: 3 };
          return sev[a.severity] - sev[b.severity];
        })[0];
      if (adjacent && (adjacent.severity === "critical" || adjacent.severity === "high")) {
        const hrefByDomain: Record<string, string> = {
          body: "/body",
          money: "/financial",
          lead: "/tasks",
          inventory: "/inventory",
          marriage: "/journal",
          systems: "/system",
          strategy: "/strategy",
          mind: "/brain",
        };
        chip = {
          domain: adjacent.domain,
          text: `Also watching: ${adjacent.description.slice(0, 60)}`,
          action: adjacent.suggestedAction.slice(0, 30),
          href: hrefByDomain[adjacent.domain.toLowerCase()] || "/strategy",
          severity: adjacent.severity,
        };
      }
    }

    if (!chip) {
      return NextResponse.json({ chip: null });
    }

    // Record for session dedupe
    RECENT_CHIPS.set(dedupeKey, { at: Date.now(), domain: chip.domain });
    if (RECENT_CHIPS.size > 30) {
      // GC old entries
      const cutoff = Date.now() - 2 * RECENT_CHIP_WINDOW_MS;
      for (const [k, v] of RECENT_CHIPS.entries()) {
        if (v.at < cutoff) RECENT_CHIPS.delete(k);
      }
    }

    return NextResponse.json({ chip });
  } catch (err) {
    return NextResponse.json(
      {
        chip: null,
        error: err instanceof Error ? err.message : "lane-check failed",
        code: "LANE_CHECK_FAILED",
      },
      { status: 200 } // don't break chat on lane-check failure
    );
  }
}
