/**
 * Task→Mission classifier · Wave AA Phase 1B · 2026-05-28.
 *
 * Given an operator's quick-add task title + the list of active missions,
 * returns the best-fit mission id + confidence 0-1 + 1-line rationale.
 *
 *   < 60% confidence  → /missions surfaces "📍 attach to <mission>?" chip
 *   ≥ 60% confidence  → silent attach + tiny toast confirming the mission
 *
 * Cost target · <$0.0008 per call. Uses gpt-4o-mini via tracedAiChat
 * with the "reason" profile for structured JSON output.
 *
 * Failure mode · returns { missionId: null, confidence: 0 } so the
 * quick-add path falls through to creating the task as unattached.
 */

import "server-only";

import { tracedAiChat } from "@/lib/ai/traced-aichat";

export interface ClassifyTaskInput {
  taskTitle: string;
  missions: Array<{ id: string; title: string; domain?: string | null }>;
}

export interface ClassifyTaskResult {
  /** Best-fit mission id · null when no mission is a confident match
   *  AND no mission is even weakly related. */
  missionId: string | null;
  /** 0.0-1.0 · classifier's confidence in the chosen missionId. */
  confidence: number;
  /** 1-sentence rationale · operator-readable · empty when no match. */
  rationale: string;
}

const FALLBACK: ClassifyTaskResult = {
  missionId: null,
  confidence: 0,
  rationale: "",
};

const SYSTEM_PROMPT = `You are an attention-routing classifier for an operator's
personal-OS quick-add. Given a single task title + a list of the operator's
active missions, return ONE JSON object choosing the best-fit mission:

{
  "missionId": "<one of the provided ids> | null",
  "confidence": 0.0-1.0,
  "rationale": "one short sentence explaining the fit (or why none)"
}

RULES:
- Return missionId=null ONLY when zero missions are even weakly related.
  Otherwise return your best guess even if confidence is low — the operator
  will see a 'are you sure?' chip when confidence < 0.6.
- Confidence calibration:
    > 0.85 · obvious keyword + domain match
    0.60-0.85 · clear thematic match
    0.30-0.60 · plausible · operator should verify
    < 0.30 · weak / probably unattached
- Rationale stays under 80 chars · plain language · no preamble.
- Return ONLY the JSON object · no preamble · no markdown fences.`;

export async function classifyTaskToMission(
  input: ClassifyTaskInput,
): Promise<ClassifyTaskResult> {
  const title = input.taskTitle.trim().slice(0, 200);
  if (!title) return FALLBACK;
  if (input.missions.length === 0) return FALLBACK;

  const missionsBlock = input.missions
    .slice(0, 30) // cap input size · 30 active missions is already a lot
    .map(
      (m, i) =>
        `${i + 1}. id="${m.id}" title="${m.title}"${m.domain ? ` domain="${m.domain}"` : ""}`,
    )
    .join("\n");

  try {
    const result = await tracedAiChat(
      { label: "classify-task-mission", source: "tool" },
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `TASK: ${title}\n\nACTIVE MISSIONS:\n${missionsBlock}`,
        },
      ],
      "reason",
    );

    const text = result.content?.trim();
    if (!text) return FALLBACK;

    // Be defensive about the JSON · the model sometimes returns markdown
    // fences despite the system prompt; strip them.
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned) as ClassifyTaskResult;

    if (
      typeof parsed.missionId !== "string" &&
      parsed.missionId !== null
    ) {
      return FALLBACK;
    }
    const confidence = clamp01(Number(parsed.confidence ?? 0));
    const rationale = String(parsed.rationale ?? "").slice(0, 200);

    // Verify the returned id was actually one of the provided missions ·
    // hallucinated ids fall through to unattached.
    if (
      parsed.missionId !== null &&
      !input.missions.some((m) => m.id === parsed.missionId)
    ) {
      return FALLBACK;
    }

    return {
      missionId: parsed.missionId,
      confidence,
      rationale,
    };
  } catch {
    return FALLBACK;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
