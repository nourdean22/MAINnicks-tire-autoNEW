import "server-only";
import { detectChatMode, type ChatMode } from "@/lib/ai/chat-mode-detect";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

// ═════════════════════════════════════════════════════════════════════════════
// Domain Routing (formerly lib/ai/domain-routing.ts)
// ═════════════════════════════════════════════════════════════════════════════

export type Domain =
  | "marketing"   // Cleveland-brand content, captions, hashtags
  | "code"        // TypeScript, SQL, Prisma migrations, deploys
  | "strategy"    // long-form planning, second-order reasoning
  | "vision"      // photo/image analysis, multimodal
  | "fast-classify" // yes/no, intent detection, lightweight
  | "creative"    // brainstorming, copy variations, alt-angles
  | "summary"     // compression, distillation, recap
  | "general";    // default conversational chat

export interface DomainRoute {
  domain: Domain;
  taskType: "fast" | "reason" | "deep" | "vision" | "code" | "creative" | "summary" | "classify" | "extract" | "math" | "sql";
  preferLargeContext: boolean;
  /** Human label for debug logging */
  label: string;
}

const PATTERNS: Array<{ test: RegExp; route: DomainRoute }> = [
  // ── CODE — JS/TS/SQL/DSL keywords + stack traces + GitHub mentions ──
  {
    test: /\b(typescript|javascript|prisma|sql|migration|deploy|next\.js|react\s+component|tsx?\s+file|\.ts|github|pull\s+request|merge\s+conflict|stack\s+trace|TypeError|ReferenceError|fix\s+the\s+bug|refactor|implement|wire\s+up|hook\s+up)\b/i,
    route: {
      domain: "code",
      taskType: "code",
      preferLargeContext: true,
      label: "code → ollama qwen3-coder",
    },
  },
  // ── VISION — image upload, photo analysis, OCR ──
  {
    test: /\b(this\s+image|this\s+photo|the\s+photo|caption\s+this|describe\s+this\s+image|ocr|read\s+the\s+(text|sign)|what's\s+in\s+(this|the)\s+(image|photo))\b/i,
    route: {
      domain: "vision",
      taskType: "vision",
      preferLargeContext: true,
      label: "vision → ollama qwen3-vl",
    },
  },
  // ── STRATEGY — multi-step planning, war-room, long-form ──
  {
    test: /\b(strategy|strategic|plan\s+(my\s+(week|month|quarter)|the\s+launch)|second-order|opportunity\s+cost|trade-off|war\s+room|10[\s-]year|long[\s-]term\s+plan|moat|competitive\s+advantage)\b/i,
    route: {
      domain: "strategy",
      taskType: "deep",
      preferLargeContext: true,
      label: "strategy → ollama deepseek-v4-pro",
    },
  },
  // ── MARKETING — content gen, captions, copy, hashtags ──
  {
    test: /\b(caption|instagram|reel|story|tiktok|hashtag|post\s+for|write\s+a\s+(post|caption|ad)|marketing|gbp|google\s+business|ad\s+copy|landing\s+page\s+copy|cta|hook\s+for)\b/i,
    route: {
      domain: "marketing",
      taskType: "creative",
      preferLargeContext: false,
      label: "marketing",
    },
  },
  // ── CREATIVE — brainstorm, alt angles, variations ──
  {
    test: /\b(brainstorm|alt(ernate)?\s+angle|variation|riff\s+on|come\s+up\s+with|out[\s-]of[\s-]the[\s-]box|unconventional|wild\s+ideas?)\b/i,
    route: {
      domain: "creative",
      taskType: "creative",
      preferLargeContext: false,
      label: "creative",
    },
  },
  // ── FAST-CLASSIFY — yes/no, intent, single-word ──
  {
    test: /^(yes|no|y|n|sure|ok|stop|cancel|skip|next|done|got\s+it|tldr|tl;dr)\.?\s*$/i,
    route: {
      domain: "fast-classify",
      taskType: "classify",
      preferLargeContext: false,
      label: "fast-classify",
    },
  },
  // ── SUMMARY — compress, recap, tl;dr ──
  {
    test: /\b(summari[sz]e|recap|tl;dr|brief\s+me|what\s+happened|catch\s+me\s+up|distill|condense)\b/i,
    route: {
      domain: "summary",
      taskType: "summary",
      preferLargeContext: false,
      label: "summary",
    },
  },
];

export function detectDomain(
  message: string,
  options: { hasImageAttachments?: boolean } = {},
): DomainRoute {
  if (options.hasImageAttachments) {
    return {
      domain: "vision",
      taskType: "vision",
      preferLargeContext: true,
      label: "vision → ollama qwen3-vl (auto-detected from attachment)",
    };
  }
  if (!message) {
    return {
      domain: "general",
      taskType: "reason",
      preferLargeContext: false,
      label: "general → default",
    };
  }
  for (const { test, route } of PATTERNS) {
    if (test.test(message)) return route;
  }
  return {
    domain: "general",
    taskType: "reason",
    preferLargeContext: false,
    label: "general → default",
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Intent Routing (formerly lib/ai/runtime/intent-router.ts)
// ═════════════════════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════════════════════
// Unified Consolidated Entrance
// ═════════════════════════════════════════════════════════════════════════════

export interface ChatTurnClassification {
  mode: ChatMode;
  domainRoute: DomainRoute;
  intent: IntentClassification;
}

export async function classifyChatTurn(
  userMessage: string,
  options: { hasImageAttachments?: boolean; messageCount?: number; traceId?: string } = {}
): Promise<ChatTurnClassification> {
  const mode = detectChatMode(userMessage, options.messageCount ?? 1);
  const domainRoute = detectDomain(userMessage, { hasImageAttachments: options.hasImageAttachments });
  const intent = await classifyIntent(userMessage, options.traceId);
  return { mode, domainRoute, intent };
}
