import { NextResponse } from "next/server";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

import { requireSession } from "@/lib/auth-guard";
/**
 * POST /api/ultron/plan
 *
 * Micro-plan compiler. Takes free-text intent ("close out the day well")
 * and returns 3-6 concrete executable steps with suggested action types.
 *
 * Body:  { intent: string }
 * Returns:
 *   {
 *     steps: [{
 *       id: string,
 *       title: string,          // human-readable step ("log today's score")
 *       action: "task" | "capture" | "nav" | "reminder" | "toggle",
 *       target?: string,        // href for nav, task title for task, etc.
 *       effort?: "M5"|"M15"|"M30"|"H1"
 *     }],
 *     summary: string,
 *     reasoning: string,
 *   }
 *
 * The UI renders each step with a one-click "do it" button that interprets
 * the action kind (navigates, creates a task, opens capture, etc.). No
 * server-side execution — the client decides what to do, keeping the API
 * pure.
 */

interface PlanStep {
  id: string;
  title: string;
  action: "task" | "capture" | "nav" | "reminder" | "toggle" | "note";
  target?: string;   // href for nav, task text for task
  effort?: "M5" | "M15" | "M30" | "H1";
}

interface PlanResult {
  steps: PlanStep[];
  summary: string;
  reasoning: string;
}

export async function POST(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json().catch(() => ({}))) as { intent?: string };
    const intent = (body.intent ?? "").trim();
    if (!intent || intent.length < 3) {
      return NextResponse.json({ error: "intent required (min 3 chars)" }, { status: 400 });
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

    let parsed: PlanResult;
    try {
      const clean = resp.content.replace(/```json/g, "").replace(/```/g, "").trim();
      const raw = JSON.parse(clean) as Partial<PlanResult>;
      parsed = {
        steps: Array.isArray(raw.steps)
          ? raw.steps.slice(0, 6).map((s, i) => ({
              id: (s.id || `step-${i + 1}`).slice(0, 20),
              title: (s.title || "").toString().trim() || `step ${i + 1}`,
              action: (["task", "capture", "nav", "reminder", "toggle", "note"].includes(s.action as string)
                ? s.action
                : "note") as PlanStep["action"],
              target: s.target || undefined,
              effort: (["M5", "M15", "M30", "H1"].includes(s.effort as string) ? s.effort : undefined) as PlanStep["effort"],
            }))
          : [],
        summary: (raw.summary || "").toString().trim() || intent,
        reasoning: (raw.reasoning || "").toString().trim() || "compiled from intent",
      };
    } catch {
      return NextResponse.json(
        {
          data: {
            steps: [{
              id: "fallback",
              title: intent.slice(0, 120),
              action: "note" as const,
              effort: "M15" as const,
            }],
            summary: intent,
            reasoning: "AI output unparsable — showing raw intent",
          },
        },
      );
    }

    return NextResponse.json({ data: parsed });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
