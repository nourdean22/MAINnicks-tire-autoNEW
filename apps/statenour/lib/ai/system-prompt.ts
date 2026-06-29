/**
 * lib/ai/system-prompt.ts · Prompt V2 Prime Cutover · 2026-06-29
 *
 * Orchestrator for the system prompt. Completely bypasses and deletes V1 compilation,
 * routing all requests directly to Prompt V2 (lib/ai/prompt/v2/).
 */

import { cached } from "@/lib/utils/cache";
import { AsyncLocalStorage } from "node:async_hooks";

export type TopicTier = "core" | "business" | "personal" | "strategy" | "full";

const BUSINESS_SIGNALS = /\b(revenue|lead|estimate|invoice|customer|callback|job|auto labor|shop|tire|price|profit|deal|quote|sale|appointment|booking|gbp|google|ads|marketing|fleet)\b/i;
const PERSONAL_SIGNALS = /\b(workout|energy|sleep|weight|habit|body|dania|health|mood|discipline|focus|adderall|boxing|gym|meditation|prayer|water|walk)\b/i;
const STRATEGY_SIGNALS = /\b(analy[zs]e|plan|strategy|goal|decision|long.term|think about|should i|what if|opportunity|pattern|trend|forecast|risk|leverage|power)\b/i;

export function detectTopicTier(message: string): TopicTier {
  if (!message || message.length < 5) return "core";
  const hasBiz = BUSINESS_SIGNALS.test(message);
  const hasPersonal = PERSONAL_SIGNALS.test(message);
  const hasStrategy = STRATEGY_SIGNALS.test(message);
  // Multiple domains → full load
  if ((hasBiz && hasPersonal) || (hasBiz && hasStrategy) || (hasPersonal && hasStrategy)) return "full";
  if (hasBiz) return "business";
  if (hasPersonal) return "personal";
  if (hasStrategy) return "strategy";
  return "core";
}

interface PromptTelemetry {
  tier: TopicTier;
  engineRuns: number;
  engineSkips: number;
}

const telemetryStore = new AsyncLocalStorage<PromptTelemetry>();

export function withPromptTelemetry<T>(tier: TopicTier, fn: () => Promise<T>): Promise<{
  result: T;
  telemetry: PromptTelemetry;
}> {
  const tel: PromptTelemetry = { tier, engineRuns: 0, engineSkips: 0 };
  return telemetryStore.run(tel, async () => {
    const result = await fn();
    return { result, telemetry: tel };
  });
}

export async function buildSystemPrompt(
  tier?: TopicTier,
  userMessage?: string | null,
  conversationId?: string | null,
): Promise<string> {
  const effectiveTier = tier || "full";
  const { detectContentIntent, detectContentDeepIntent, detectSmsIntent } = await import("./business-knowledge");
  const contentMode = detectContentIntent(userMessage);
  const deepMode = contentMode && detectContentDeepIntent(userMessage);
  const slot = deepMode ? "deep" : contentMode ? "content" : detectSmsIntent(userMessage) ? "sms" : "default";

  // Use the date + 4h bucket in the cache key to partition by time-of-day
  const _now = new Date();
  const _dayKey = _now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const _hour = parseInt(
    _now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    10,
  );
  const _bucket = _hour < 12 ? "am" : _hour < 17 ? "pm" : "eve";
  const cacheKey = `system_prompt_v2_${effectiveTier}_${slot}_${_dayKey}_${_bucket}`;

  return cached(cacheKey, 300, async () => {
    const { buildSystemPromptV2 } = await import("./prompt/v2");
    const out = await buildSystemPromptV2();
    return trimPromptToBudget(out.prompt, 58000);
  });
}

export async function buildSystemPromptUncached(
  tier: TopicTier = "full",
  userMessage: string | null = null,
): Promise<string> {
  const { buildSystemPromptV2 } = await import("./prompt/v2");
  const out = await buildSystemPromptV2();
  return trimPromptToBudget(out.prompt, 58000);
}

export function trimPromptToBudget(prompt: string, maxLimit = 58000): string {
  if (prompt.length <= maxLimit) return prompt;

  const sections = prompt.split(/\n(?=## )/g);
  
  const getSectionPriority = (title: string): number => {
    const t = title.toLowerCase();
    if (t.includes("behavior directive") || t.includes("how to respond") || t.includes("identity") || t.includes("voice")) return 1;
    if (t.includes("pinned by") || t.includes("hot rules") || t.includes("anchor")) return 2;
    if (t.includes("command state") || t.includes("active command") || t.includes("queue")) return 3;
    if (t.includes("today:") || t.includes("temporal") || t.includes("time-aware")) return 4;
    if (t.includes("active risk") || t.includes("risks")) return 5;
    
    if (t.includes("business —") || t.includes("live shop") || t.includes("metrics") || t.includes("domain")) return 10;
    if (t.includes("today's proof") || t.includes("proof")) return 11;
    if (t.includes("missions") || t.includes("goals") || t.includes("why")) return 12;
    if (t.includes("decisions")) return 13;
    if (t.includes("unacknowledged insights")) return 14;
    if (t.includes("follow-ups") || t.includes("anticipated questions")) return 15;
    
    if (t.includes("recent brain dumps") || t.includes("brain dump")) return 20;
    if (t.includes("reflections") || t.includes("insight")) return 21;
    if (t.includes("learned knowledge") || t.includes("facts") || t.includes("cold memory")) return 22;
    if (t.includes("knowledge base") || t.includes("chatgpt")) return 23;
    
    return 30;
  };

  const mappedSections = sections.map((sec, idx) => {
    const firstLine = sec.split("\n")[0] || "";
    const priority = getSectionPriority(firstLine);
    return { idx, text: sec, priority };
  });

  const activeIndices = new Set(mappedSections.map(s => s.idx));
  const rebuild = () => sections.filter((_, idx) => activeIndices.has(idx)).join("\n");

  const dropCandidates = [...mappedSections].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.idx - a.idx;
  });

  for (const candidate of dropCandidates) {
    if (rebuild().length <= maxLimit) break;
    if (candidate.priority < 10) continue;
    activeIndices.delete(candidate.idx);
  }

  let finalPrompt = rebuild();
  if (finalPrompt.length > maxLimit) {
    finalPrompt = finalPrompt.slice(0, maxLimit - 100) + "\n\n[PROMPT TRUNCATED FOR BUDGET HARDENING]\n";
  }

  return finalPrompt;
}
