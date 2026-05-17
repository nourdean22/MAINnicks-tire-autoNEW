/**
 * POST /api/chat/reword
 *
 * Item #10 from the excellence marathon. Takes a user question and
 * returns 3 alternative phrasings that might get a better answer.
 * The chat UI's regenerate menu uses this to offer "Reword & retry"
 * — fixes the 'I didn't phrase that well' problem without losing
 * conversation state.
 *
 * Body: { question: string }
 * Returns: { rewordings: Array<{ label: string; text: string }> }
 */

import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { recordError } from "@/lib/errors/record-error";

import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await requireSession(req);
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard
  try {
    const body = (await req.json()) as { question: string };
    const question = (body.question || "").trim();

    if (!question) {
      return Response.json({ rewordings: [] });
    }

    if (question.length > 1500) {
      return Response.json(
        { rewordings: [], error: "question too long for rewording" },
        { status: 400 }
      );
    }

    const systemPrompt = `You rephrase a user's question in 3 alternative framings to help them get a better answer. Each rephrasing should have a specific angle:
1. SPECIFIC — add concrete constraints, numbers, or scope
2. STRATEGIC — ask the bigger-picture question behind the literal one
3. TACTICAL — narrow to the smallest immediately actionable piece

Return ONLY valid JSON in this shape, no preamble or explanation:
{
  "rewordings": [
    { "label": "Specific", "text": "..." },
    { "label": "Strategic", "text": "..." },
    { "label": "Tactical", "text": "..." }
  ]
}
Each text field MUST be a question or request — not a statement. Max 200 chars each.`;

    const result = await tracedAiChat(
      { label: "chat-reword", source: "chat" },
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Rephrase this question 3 ways:\n\n${question}` },
      ],
      "creative"
    );

    if (!result.content || result.provider === "none") {
      return Response.json({ rewordings: [] });
    }

    // v10.0.228 · use shared extractor · 3-pass strategy with
    // trailing-comma + single-quoted-key repair. Pre-fix the
    // catch-all returned [] silently when JSON.parse threw; now
    // we distinguish parse-failure (logged) from empty-response.
    const extracted = extractJsonObject<{
      rewordings?: Array<{ label?: string; text?: string }>;
    }>(result.content);
    if (!extracted.ok) {
      recordError("api:unknown", new Error(extracted.error), {
        route: "chat/reword",
        rawSnippet: extracted.raw,
      });
      return Response.json({ rewordings: [] });
    }
    const cleaned = (extracted.value.rewordings || [])
      .filter((r) => r.text && typeof r.text === "string")
      .slice(0, 3)
      .map((r) => ({
        label: (r.label || "Rewording").slice(0, 20),
        text: r.text!.trim().slice(0, 240),
      }));
    return Response.json({ rewordings: cleaned });
  } catch (err) {
    recordError("api:unknown", err, { route: "chat/reword" });
    return Response.json({ rewordings: [] }, { status: 500 });
  }
}
