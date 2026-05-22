/**
 * lib/services/ultron-plan.ts · Phase B.6a (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · operator-domain
 * sub-slice).
 *
 * The micro-plan compiler. Takes free-text intent ("close out the
 * day well") and returns 3-6 concrete executable steps with suggested
 * action types. No server-side execution — the client decides what to
 * do with each step, keeping this pure.
 *
 * Extracted from the inline route logic in app/api/ultron/plan/route.ts
 * so BOTH the legacy REST route AND the new `operator.plan` tRPC
 * procedure call the same `buildMicroPlan` function · drift impossible.
 *
 * `buildMicroPlan` throws `IntentTooShortError` when the intent is
 * missing or under 3 chars · the REST route maps it to a 400, the
 * tRPC procedure maps it to BAD_REQUEST · both transports reject
 * identically.
 */

import { tracedAiChat } from "@/lib/ai/traced-aichat";

export interface PlanStep {
  id: string;
  title: string;
  action: "task" | "capture" | "nav" | "reminder" | "toggle" | "note";
  /** href for nav, task text for task */
  target?: string;
  effort?: "M5" | "M15" | "M30" | "H1";
}

export interface PlanResult {
  steps: PlanStep[];
  summary: string;
  reasoning: string;
}

/** Thrown when the intent is missing or under the 3-char floor. */
export class IntentTooShortError extends Error {
  constructor() {
    super("intent required (min 3 chars)");
    this.name = "IntentTooShortError";
  }
}

/**
 * Compile a micro-plan from a free-text intent. Returns 3-6 tiny,
 * high-leverage steps. On unparsable AI output, falls back to a
 * single note-step echoing the raw intent (never throws on a parse
 * miss · only `IntentTooShortError` on a bad input).
 */
export async function buildMicroPlan(rawIntent: string): Promise<PlanResult> {
  const intent = (rawIntent ?? "").trim();
  if (!intent || intent.length < 3) {
    throw new IntentTooShortError();
  }

  const system = `You are compiling a micro-plan for Nour — 3 to 6 concrete executable steps to achieve an intent. Steps must be tiny and high-leverage.

Output strict JSON matching:
{
  "steps": [
    {
      "id": "string (3-8 char slug)",
      "title": "imperative sentence, 4-10 words",
      "action": "task" | "capture" | "nav" | "reminder" | "toggle" | "note",
      "target": "href for nav | task title for task | reminder time for reminder",
      "effort": "M5" | "M15" | "M30" | "H1"
    }
  ],
  "summary": "1-sentence plan summary, 8-14 words",
  "reasoning": "why this plan, 10-18 words"
}

Rules:
- 3-6 steps MAX. Fewer is better.
- Prefer action:"task" for things that take > 5 min.
- Use action:"nav" with target="/path" for anything that's just navigation (e.g. /tasks, /body, /chat, /journal).
- Use action:"capture" for "write down X" steps → opens the omni-capture.
- Use action:"note" for observations/reminders that aren't actions.
- Output JSON only, no markdown.`;

  const user = `Intent: ${intent}\n\nCompile the plan.`;

  const resp = await tracedAiChat(
    { label: "ultron-plan", source: "tool" },
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    "fast",
  );

  try {
    const clean = resp.content.replace(/```json/g, "").replace(/```/g, "").trim();
    const raw = JSON.parse(clean) as Partial<PlanResult>;
    return {
      steps: Array.isArray(raw.steps)
        ? raw.steps.slice(0, 6).map((s, i) => ({
            id: (s.id || `step-${i + 1}`).slice(0, 20),
            title: (s.title || "").toString().trim() || `step ${i + 1}`,
            action: (["task", "capture", "nav", "reminder", "toggle", "note"].includes(
              s.action as string,
            )
              ? s.action
              : "note") as PlanStep["action"],
            target: s.target || undefined,
            effort: (["M5", "M15", "M30", "H1"].includes(s.effort as string)
              ? s.effort
              : undefined) as PlanStep["effort"],
          }))
        : [],
      summary: (raw.summary || "").toString().trim() || intent,
      reasoning: (raw.reasoning || "").toString().trim() || "compiled from intent",
    };
  } catch {
    return {
      steps: [
        {
          id: "fallback",
          title: intent.slice(0, 120),
          action: "note" as const,
          effort: "M15" as const,
        },
      ],
      summary: intent,
      reasoning: "AI output unparsable — showing raw intent",
    };
  }
}
