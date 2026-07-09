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

  const { detectStitchPromptIntent } = await import("@nour/ai-capabilities");
  const isStitchPrompt = userMessage ? detectStitchPromptIntent(userMessage) : false;

  const slot = isStitchPrompt
    ? "stitch_prompt"
    : deepMode
      ? "deep"
      : contentMode
        ? "content"
        : detectSmsIntent(userMessage)
          ? "sms"
          : "default";

  // Use the date + 4h bucket in the cache key to partition by time-of-day.
  // AG-35 · key prefix bumped v2 → v3: the business-knowledge layer below
  // changes what a cached prompt contains, and per the invalidation note
  // in system-prompt-cache.ts a knowledge change must never serve stale.
  const _now = new Date();
  const _dayKey = _now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const _hour = parseInt(
    _now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    10,
  );
  const _bucket = _hour < 12 ? "am" : _hour < 17 ? "pm" : "eve";
  const cacheKey = `system_prompt_v3_${effectiveTier}_${slot}_${_dayKey}_${_bucket}`;

  return cached(cacheKey, 300, async () => {
    const { buildSystemPromptV2 } = await import("./prompt/v2");
    const out = await buildSystemPromptV2();
    let prompt = trimPromptToBudget(out.prompt, 58000);

    if (slot === "stitch_prompt") {
      const { resolveDesignContext, buildEnhancePromptSystemInstructions } = await import("@nour/ai-capabilities");
      const projectPath = process.cwd();
      const brandContext = resolveDesignContext(projectPath, "statenour");
      const enhanceInstructions = buildEnhancePromptSystemInstructions(brandContext);
      prompt = `${prompt}\n\n## Capability: Stitch Prompt Engineering\n\n${enhanceInstructions}`;
    }

    prompt = await appendBusinessKnowledgeLayer(prompt, effectiveTier, slot, userMessage);

    return prompt;
  });
}

/**
 * AG-35 · the 1,632-line business knowledge pack (PRICING_POLICY,
 * SHOP_OPS_CARD, BRAND_VOICE, seasonal playbooks) was silently orphaned
 * from the live chat prompt by the 2026-06-29 Prompt V2 cutover — its
 * only prod caller was a diagnostics view, so Nick advised on the
 * business without its pricing policy in context. Appended AFTER the
 * budget trim (same pattern as the stitch layer); size stays bounded by
 * the detectors' own tier gating (light tiers get the ops card only —
 * the full pack would blow Venice's 65K window).
 */
export async function appendBusinessKnowledgeLayer(
  prompt: string,
  tier: TopicTier,
  slot: string,
  userMessage?: string | null,
): Promise<string> {
  const wantsKnowledge =
    tier === "business" || tier === "strategy" || tier === "full" ||
    slot === "content" || slot === "deep" || slot === "sms";
  if (!wantsKnowledge) return prompt;

  try {
    const { getBusinessKnowledge } = await import("./knowledge/detectors");
    // TopicTier → KnowledgeTier: "personal" maps to the light "chat"
    // tier (ops card only); the other values coincide.
    const knowledgeTier = tier === "personal" ? "chat" : tier;
    const block = getBusinessKnowledge(knowledgeTier, userMessage);
    if (!block) return prompt;
    void runBrandStalenessCanary();
    return `${prompt}\n\n${block}`;
  } catch {
    // Knowledge layer is supplementary — never blocks prompt delivery.
    return prompt;
  }
}

// AG-35 · once-per-process staleness canary: the pack's hardcoded shop
// facts date to Apr 2026 — re-injecting them re-injects any drift. One
// best-effort bridge compare per lambda instance, logged not thrown.
let brandCanaryDone = false;
async function runBrandStalenessCanary(): Promise<void> {
  if (brandCanaryDone) return;
  brandCanaryDone = true;
  try {
    const { queryNick } = await import("@/lib/nickstire/query");
    const pulse = (await queryNick("shop_pulse", {})) as
      | { pulse?: { phone?: string; hours?: string } }
      | null;
    if (!pulse?.pulse) return;
    const { SHOP_OPS_CARD } = await import("./knowledge/brand-constants");
    const phone = pulse.pulse.phone;
    if (phone && !SHOP_OPS_CARD.includes(phone.replace(/\D/g, "").slice(-10))) {
      const { logger } = await import("@/lib/logger");
      logger.withSurface("ai/system-prompt").warn("brand_constants_stale", {
        note: "bridge shop phone not found in SHOP_OPS_CARD — pack facts may have drifted",
      });
    }
  } catch {
    // bridge unkeyed / offline — silent skip
  }
}

export async function buildSystemPromptUncached(
  tier: TopicTier = "full",
  userMessage: string | null = null,
): Promise<string> {
  const { buildSystemPromptV2 } = await import("./prompt/v2");
  const out = await buildSystemPromptV2();
  let prompt = trimPromptToBudget(out.prompt, 58000);

  // AG-35 · same knowledge layer as the cached path. The uncached path
  // has no slot detection — tier alone gates (content/sms callers use
  // buildSystemPrompt).
  prompt = await appendBusinessKnowledgeLayer(prompt, tier, "default", userMessage);

  if (userMessage) {
    const { detectStitchPromptIntent, resolveDesignContext, buildEnhancePromptSystemInstructions } = await import("@nour/ai-capabilities");
    if (detectStitchPromptIntent(userMessage)) {
      const projectPath = process.cwd();
      const brandContext = resolveDesignContext(projectPath, "statenour");
      const enhanceInstructions = buildEnhancePromptSystemInstructions(brandContext);
      prompt = `${prompt}\n\n## Capability: Stitch Prompt Engineering\n\n${enhanceInstructions}`;
    }
  }

  return prompt;
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
