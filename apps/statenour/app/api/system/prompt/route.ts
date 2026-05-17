/**
 * /api/system/prompt — live system-prompt diagnostics.
 *
 * v6 · Returns the actual prompt that WOULD be built right now for a
 * given tier + sample user message. Used by the /system/prompt page so
 * Nour can see:
 *   · which tier slot is active (core / business / content / deep)
 *   · total char count vs the 65k Venice limit
 *   · which sections (engines, knowledge blocks) are firing
 *   · live word count, estimated tokens
 *   · whether the v5.0 Master Content Engine is loaded
 *   · cache hit/miss status
 *
 * Query params:
 *   ?tier=core|business|personal|strategy|full   (default: full)
 *   ?msg=<sample message>                        (default: empty)
 *
 * Auth: session-cookie.
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. Page reads
 * top-level keys (data.size.truncating, data.tier.detected, etc) so
 * we return raw NextResponse · apiHandler still provides rate-limit,
 * auth, audit trace IDs, sanitized errors.
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/utils/http";
import { buildSystemPrompt, detectTopicTier } from "@/lib/ai/system-prompt";
import {
  detectContentDeepIntent,
  getBusinessKnowledge,
} from "@/lib/ai/business-knowledge";
import { detectContentIntentAsync } from "@/lib/ai/content-intent";
import { getCacheStats } from "@/lib/ai/system-prompt-cache";
import { getProviderStatus } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VENICE_LIMIT = 65_000;

export const GET = apiHandler(
  async (req) => {
    const { searchParams } = new URL(req.url);
    const tierParam = (searchParams.get("tier") ?? "full") as
      | "core"
      | "business"
      | "personal"
      | "strategy"
      | "full";
    const msg = searchParams.get("msg") ?? "";

    // Auto-detect tier when sample msg is provided + no explicit override
    const detectedTier = msg && tierParam === "full" ? detectTopicTier(msg) : tierParam;

    // Build the prompt
    const t0 = Date.now();
    const prompt = await buildSystemPrompt(detectedTier, msg || null);
    const buildMs = Date.now() - t0;

    // Slot detection (default / content / deep) — uses the layered detector
    // so the diagnostics page surfaces WHY a query was classified.
    const intentDetail = await detectContentIntentAsync(msg);
    const isContent = intentDetail.isContent;
    const isDeep = isContent && detectContentDeepIntent(msg);
    const slot = isDeep ? "deep" : isContent ? "content" : "default";

    // Knowledge module size at this tier + slot
    const knowledgeOnly = getBusinessKnowledge(
      detectedTier === "personal" ? "chat"
      : detectedTier === "core" ? "core"
      : (detectedTier as "business" | "strategy" | "full"),
      msg || null,
    );

    // Section breakdown — split prompt by ## or ### headings + size each
    const sectionLines = prompt.split("\n");
    const sections: Array<{ title: string; chars: number; lines: number }> = [];
    let current: { title: string; lines: string[] } | null = null;
    for (const line of sectionLines) {
      if (/^#{1,3}\s/.test(line)) {
        if (current) {
          const body = current.lines.join("\n");
          sections.push({ title: current.title, chars: body.length, lines: current.lines.length });
        }
        current = { title: line.replace(/^#{1,3}\s/, "").slice(0, 90), lines: [] };
      } else if (current) {
        current.lines.push(line);
      }
    }
    if (current) {
      const body = current.lines.join("\n");
      sections.push({ title: current.title, chars: body.length, lines: current.lines.length });
    }
    // Top 25 by char count — the heavy hitters
    const topSections = [...sections].sort((a, b) => b.chars - a.chars).slice(0, 25);

    // Token estimate (rough: ~3.5 chars per token for dense prose)
    const tokensEst = Math.round(prompt.length / 3.5);
    const wordsEst = prompt.trim().split(/\s+/).length;

    // Truncation status
    const overBy = prompt.length - VENICE_LIMIT;
    const truncating = overBy > 0;
    const utilization = Math.round((prompt.length / VENICE_LIMIT) * 100);

    return NextResponse.json({
      ok: true,
      tier: {
        requested: tierParam,
        detected: detectedTier,
        slot,
      },
      size: {
        chars: prompt.length,
        words: wordsEst,
        tokensEst,
        veniceLimit: VENICE_LIMIT,
        utilization,
        truncating,
        overBy: Math.max(0, overBy),
      },
      knowledge: {
        moduleChars: knowledgeOnly.length,
        contentEngineLoaded: isContent,
        deepEngineLoaded: isDeep,
      },
      intent: {
        isContent: intentDetail.isContent,
        confidence: intentDetail.confidence,
        rawScore: intentDetail.rawScore,
        reasons: intentDetail.reasons,
        embedSimilarity: intentDetail.embedSimilarity,
        usedEmbedding: intentDetail.usedEmbedding,
      },
      sections: topSections,
      sectionCount: sections.length,
      buildMs,
      cache: getCacheStats(),
      providers: getProviderStatus().providers,
      headPreview: prompt.slice(0, 1500),
      tailPreview: prompt.slice(-800),
    });
  },
  { auth: "owner" },
);
