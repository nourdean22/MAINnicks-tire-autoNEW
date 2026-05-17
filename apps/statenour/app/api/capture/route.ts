import { prisma } from "@/lib/prisma";
import { nanoid } from "nanoid";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

export const maxDuration = 60;

export const dynamic = "force-dynamic";

/**
 * POST /api/capture — Zero-friction quick capture from anywhere.
 * Body: { text: string, source?: string }
 *
 * Captures a thought, auto-tags it, and triages it into the inbox.
 * Use from phone, CLI, or any HTTP client.
 *
 * v10.0.119 audit-pattern fix · was unauthenticated. The
 * tracedAiChat call burns real $$ per request, and the create
 * persists arbitrary attacker-supplied content. Now owner-gated.
 * Phone / CLI clients still work — they need to ride a session
 * cookie or use the sync key path.
 */
export const POST = apiHandler(async (req) => {
  const body = await req.json();
  const text = body.text?.trim();
  if (!text) {
    throw new ServiceError("text is required", 400);
  }

  const source = body.source || "api";

  // Auto-triage with fast model (async, don't block the capture)
  let primaryTag = "untagged";
  let actionabilityScore = 50;
  let summary = text.slice(0, 200);

  try {
    const result = await tracedAiChat(
      { label: "capture-triage", source: "tool", metadata: { source } },
      [
        {
          role: "system",
          content: `You triage inbox items for a personal OS. Return ONLY JSON: {"tag":"one_word_tag","score":0-100,"summary":"one_sentence"}. Score = how actionable (100 = do now, 0 = reference only).`,
        },
        { role: "user", content: text.slice(0, 500) },
      ],
      "fast"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extracted = extractJsonObject<any>(result.content);
    if (extracted.ok) {
      const parsed = extracted.value;
      primaryTag = parsed.tag || primaryTag;
      actionabilityScore = parsed.score ?? actionabilityScore;
      summary = parsed.summary || summary;
    }
  } catch {
    // Triage failed — capture anyway with defaults
  }

  const item = await prisma.captureInboxItem.create({
    data: {
      itemKey: `capture-${nanoid(10)}`,
      source,
      kind: "thought",
      title: text.slice(0, 100),
      summary,
      primaryTag,
      actionabilityScore,
      capturedAt: new Date(),
    },
  });

  return {
    id: item.id,
    tag: primaryTag,
    score: actionabilityScore,
    summary,
  };
}, { auth: "owner" });
