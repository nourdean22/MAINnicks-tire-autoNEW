import "server-only";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

export interface IntentClassification {
  intent: string;
  mode: "fast" | "operator" | "engineer";
  model: string;
  provider: string;
  targets: string[];
}

const INTENT_SYSTEM_PROMPT = `You are an intent router for Nour's cockpit assistant (Nick).
Your job is to analyze the user's request and categorize it for processing.

Analyze the request and return a single JSON object with the following fields:
{
  "intent": "lead_outreach" | "system_mutation" | "code_engineering" | "task_management" | "cron_diagnostic" | "general_chat",
  "mode": "fast" | "operator" | "engineer",
  "targets": ["external_api", "database", "crm", "sms", "git", "logs", "general"]
}

MODE HEURISTICS:
- "fast": quick greetings, simple queries, ping/pong, non-technical chitchat (e.g., "hi", "who are you", "test").
- "operator": business ops, CRM actions, task updates, SMS outreach, schedule queries, cron checking, lead updates (e.g., "send text to Dania", "audit today's leads", "diagnose cron failure").
- "engineer": file editing, code generation, git commands, database schema migrations, prisma validation, setup, local scripts (e.g., "write a script to parse logs", "add field X to database", "refactor route.ts").

INTENT HEURISTICS:
- "lead_outreach": sending texts to clients, CRM updates, tire/estimate follow-ups.
- "system_mutation": altering system state, clearing database tables, manually updating settings.
- "code_engineering": editing code, writing scripts, refactoring files, git/Prisma changes.
- "task_management": creating/modifying/triaging loops or tasks, snoozing tasks, changing priorities.
- "cron_diagnostic": inspecting failed runs, checking service health, checking cron logs.
- "general_chat": general chatting, strategy, reflections, non-technical queries.

Return ONLY the JSON object. Do not include markdown formatting or backticks.`;

export async function classifyIntent(
  userMessage: string,
  traceId?: string
): Promise<IntentClassification> {
  const messageTrimmed = userMessage.trim().slice(0, 1000);

  // Quick fallback heuristic for extremely short common fast messages
  const lowerMsg = messageTrimmed.toLowerCase();
  if (
    lowerMsg === "ping" ||
    lowerMsg === "hi" ||
    lowerMsg === "hello" ||
    lowerMsg === "test" ||
    lowerMsg === "who are you"
  ) {
    return {
      intent: "general_chat",
      mode: "fast",
      model: "heuristic",
      provider: "system",
      targets: ["general"],
    };
  }

  try {
    const result = await tracedAiChat(
      {
        label: "intent-router",
        source: "chat",
        parentTraceId: traceId,
      },
      [
        { role: "system", content: INTENT_SYSTEM_PROMPT },
        { role: "user", content: `Request: ${messageTrimmed}` },
      ],
      "classify"
    );

    const raw = (result.content ?? "").trim();
    const jsonText = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    const parsed = JSON.parse(jsonText);

    return {
      intent: typeof parsed.intent === "string" ? parsed.intent : "general_chat",
      mode:
        parsed.mode === "fast" ||
        parsed.mode === "operator" ||
        parsed.mode === "engineer"
          ? parsed.mode
          : "operator",
      model: result.model || "unknown",
      provider: result.provider || "unknown",
      targets: Array.isArray(parsed.targets) ? parsed.targets : ["general"],
    };
  } catch (err) {
    console.warn("[intent-router] classification failed, using fallback:", err);
    return {
      intent: "general_chat",
      mode: "operator",
      model: "fallback",
      provider: "system",
      targets: ["general"],
    };
  }
}
