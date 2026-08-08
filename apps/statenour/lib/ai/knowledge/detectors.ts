/**
 * Nick's Tire & Auto — knowledge detectors + tier-gated loader.
 *
 * v10.0.529.106 · Wave 85 · split out of `lib/ai/business-knowledge.ts`.
 * Constants moved to `./brand-constants.ts`. This file holds the
 * detection regex + the three public functions that pick which
 * constants to render based on the user's message.
 *
 * THREE LOAD TIERS (see `getBusinessKnowledge` below):
 *   1. CORE/CHAT — just OPS_CARD (~700 chars). Casual "hey" messages.
 *   2. BUSINESS (default) — foundation only: model, voice, pricing,
 *      customer, differentiation, hard rules, seasonal playbook,
 *      revenue funnel, success profile. ~8kc. (2026-06-10: Cleveland
 *      identity + equipment authority + SMS voice moved to content
 *      mode / the SMS gate — they are content reference cards.)
 *   3. CONTENT MODE — foundation + Master Content Engine v5.0
 *      essentials, plus opt-in DEEP block for strategy / planning
 *      questions. Capped near Venice's 65k system-prompt limit.
 *
 * CONTENT-MODE DETECTION: signal-based regex on the user's last
 * message. If ≥1 marketing-content signal hits, content mode is on.
 * Detection is permissive — better to over-inject for a content ask
 * than skip the engine when it's needed.
 */

import { detectContentIntentSync } from "@/lib/ai/content-intent";
import {
  ALGORITHM_PRIORITIES,
  BRAND_VOICE,
  CAPTION_ENGINE,
  CAROUSEL_ENGINE,
  CAPTURE_SYSTEM,
  CLEVELAND_IDENTITY,
  CONTENT_GENERATION_MODE,
  CONTENT_PILLARS,
  CONVERSION_SYSTEM,
  CREATIVE_ANGLES,
  CTA_RULES,
  CUSTOMER_COVENANT,
  CUSTOMER_PROFILE,
  DAILY_OUTPUT_TEMPLATE,
  DAILY_ROTATION,
  DIGITAL_PRESENCE,
  ENGAGEMENT_PROMPTS,
  EQUIPMENT_AUTHORITY,
  FINAL_MASTER_RULES,
  FIRST_HOUR_PROTOCOL,
  FOUR_PILLARS,
  HARD_RULES,
  HOOK_FAMILIES,
  IDEAS_VAULT,
  IG_SEO_AND_HASHTAGS,
  type KnowledgeTier,
  MONTHLY_CAMPAIGNS,
  NEVER_GENERIC,
  NINETY_DAY_PLAN,
  OFFER_ENGINE,
  OFFLINE_INTEGRATION,
  PAID_BOOSTING,
  PERFORMANCE_SYSTEM,
  POSTING_CADENCE,
  PRICING_POLICY,
  PRIME_DIRECTIVE,
  PSYCHOLOGY_PRINCIPLES,
  QUALITY_CONTROL,
  REELS_ENGINE,
  RESPONSE_SCRIPTS,
  REVENUE_FUNNEL,
  REVIEW_ENGINE,
  SEASONAL_PLAYBOOKS,
  SHOP_DIFFERENTIATION,
  SHOP_MODEL,
  SHOP_OPS_CARD,
  SIGNATURE_SERIES,
  SMS_VOICE,
  STORY_ENGINE,
  SUCCESS_PROFILE,
  SUCCESS_STACK,
  TEN_POST_MIX,
  THIRTY_DAY_MAP,
  TRAFFIC_CAMPAIGNS,
  VISUAL_LAYOUTS,
} from "./brand-constants";

/**
 * Returns true if the user's message looks like a request for content
 * generation (post, caption, ad copy, marketing material). When true,
 * the Master Content Engine v5.0 sections are injected. Otherwise
 * we save ~40kc of system-prompt budget.
 *
 * v6 · Apr 28 router-upgrade — Delegates to the layered detector in
 * `content-intent.ts`. Keeps the same boolean signature for backward
 * compat. The detector applies:
 *   · weighted keywords (10 → 1 point per term, verb-position aware)
 *   · negation suppression ("I'm NOT asking for a post")
 *   · multi-signal adjustments (imperative-start, length, prev-turn)
 *
 * This is the SYNC path — no embedding fallback. For middle-band
 * ambiguity the chat route + system-prompt builder should call
 * `detectContentIntentAsync` from `lib/ai/content-intent.ts` instead.
 */
export function detectContentIntent(message: string | null | undefined): boolean {
  if (!message) return false;
  // 2026-06-10 · was a lazy require "so module load order stays clean"
  // — content-intent.ts has ZERO imports (no cycle is possible), and
  // CJS require of TS modules doesn't resolve under vitest, which made
  // every real test of this path impossible. Static import is safe.
  return detectContentIntentSync(message).isContent;
}

// Deep content mode — only fires when user is asking about strategy,
// planning, or review systems. Otherwise we'd burn 25kc of Venice
// budget on operational depth that's irrelevant to "give me a post."
const CONTENT_DEEP_INTENT_RE =
  /\b(plan|planning|strategy|calendar|cadence|schedule|monthly|month|week|weekly|review|score|scoring|performance|metrics|analytics|insights|cadence|campaign|campaigns|boost|boosting|paid|ads\s+manager|optimize|optimization|90.day|dominance|content\s+plan|content\s+calendar|content\s+strategy|engagement\s+strategy|growth\s+plan|reputation|reviews|GBP|google\s+business|profile|hashtag\s+strategy|posting\s+frequency|how\s+often)\b/i;

export function detectContentDeepIntent(message: string | null | undefined): boolean {
  if (!message) return false;
  return CONTENT_DEEP_INTENT_RE.test(message);
}

/**
 * Main loader. Optional `userMessage` lets the caller signal whether
 * the v5.0 content engine should be injected (heavy) or not (light).
 * If userMessage is undefined, content mode defaults to false — safe
 * default that keeps the prompt under Venice's 65k limit.
 */
/**
 * SMS-drafting intent · its own detector because detectContentIntent's
 * keyword list has no sms/text entries. Exported so the system-prompt
 * CACHE KEY can include it — without that, the 300s prompt cache would
 * serve a non-SMS prompt to an SMS ask (or vice versa) for up to 5min.
 */
export function detectSmsIntent(message: string | null | undefined): boolean {
  return /\b(sms|text(s|ing|ed)?|win.?back)\b/i.test(message ?? "");
}

export function getBusinessKnowledge(
  tier: KnowledgeTier,
  userMessage?: string | null,
): string {
  // 2026-08-08 · block titles are two-hash headers on purpose —
  // trimPromptToBudget splits sections on newline + "## " ONLY. As
  // triple-hash titles, the whole pack fused into ONE atomic section
  // glued to whatever two-hash header came before it, so the 65k
  // runtime trim could only drop the ENTIRE engine (which is exactly
  // what non-anthropic content turns got). With two-hash titles the
  // trimmer drops sub-blocks tail-first: deep blocks go before
  // essentials, and the OPS CARD (index 0) survives longest. Do not
  // "tidy" these back to triple-hash.
  // Always include the ops card — if asked address/phone/hours, must know.
  const blocks: string[] = [
    `## NICK'S TIRE & AUTO — OPS CARD\n${SHOP_OPS_CARD}`,
  ];

  // Light tier — stop here. Saves ~5K tokens on a "hey" message.
  if (tier === "core" || tier === "chat") return blocks.join("\n\n");

  // ═══ BUSINESS FOUNDATION — always loaded for business+ tier ═══
  // ~8kc total. Identity, model, voice, pricing, customer, hard rules,
  // funnel, success profile, seasonal playbook.
  blocks.push(
    `## THE FOUR PILLARS (operating compass)\n${FOUR_PILLARS}`,
    `## BUSINESS MODEL\n${SHOP_MODEL}`,
    `## PRICING POLICY (close in person, not on the website)\n${PRICING_POLICY}`,
    `## CUSTOMER EXPERIENCE COVENANT (7 non-negotiable promises)\n${CUSTOMER_COVENANT}`,
    `## DIFFERENTIATION (vs chains, dealers, other indies)\n${SHOP_DIFFERENTIATION}`,
    `## CUSTOMER PROFILE — who walks in\n${CUSTOMER_PROFILE}`,
    `## BRAND VOICE — exact tone calibration\n${BRAND_VOICE}`,
    `## REVENUE FUNNEL — where money lives + dies\n${REVENUE_FUNNEL}`,
    `## HARD RULES (Nour's standing directives)\n${HARD_RULES}`,
    `## SUCCESS / FAILURE PROFILE — what good + bad days look like\n${SUCCESS_PROFILE}`,
  );

  // Seasonal playbook — current month's tactical push (small, ~500ch)
  const monthNum = new Date().getMonth() + 1;
  const season =
    monthNum >= 10 || monthNum <= 3
      ? "winter"
      : monthNum >= 4 && monthNum <= 5
        ? "spring"
        : monthNum >= 6 && monthNum <= 8
          ? "summer"
          : "fall";
  blocks.push(
    `## SEASONAL PLAYBOOK — ${season.toUpperCase()} (current month: ${new Date().toLocaleString("en-US", { month: "long" })})\n${SEASONAL_PLAYBOOKS[season]}`,
  );

  // ═══ CONTENT MODE — two sub-tiers ═══
  //
  // Apr 28 v3 · Content mode is split into ESSENTIALS (every content
  // ask) and DEEP (only on planning/strategy/review intent). Without
  // this split, loading the full v5.0 engine on every post-generation
  // request blew past Venice's 65k system-prompt limit and triggered
  // truncation — which silently drops older memory sections.
  //
  // ESSENTIALS (~22kc) covers everything Nick needs to produce ONE
  // strong post: rules · prime directive · pillars · angles · hooks ·
  // caption engine · visual layouts · format engines · hashtags ·
  // output template · banned phrases · master rules.
  //
  // DEEP (+~25kc, opt-in) adds strategy / operations / review
  // tooling. Only fires when the user explicitly asks about
  // campaigns / content plan / posting cadence / monthly calendar /
  // performance / scoring / 90-day / boost / etc.

  const isContentMode = detectContentIntent(userMessage);

  // 2026-06-10 prompt-budget trim · SMS_VOICE / EQUIPMENT_AUTHORITY /
  // CLEVELAND_IDENTITY are content-creation reference cards, not chat
  // knowledge — they loaded on EVERY business+ chat (~3.7kc of the
  // 60k budget). SMS_VOICE keeps its OWN regex gate (not just content
  // mode) because detectContentIntent's keyword list has no sms/text
  // entries — an SMS-drafting ask outside content mode still gets the
  // tone card. The other two ride the content-mode essentials below.
  if (isContentMode || detectSmsIntent(userMessage)) {
    blocks.push(`## SMS VOICE — outbound text-message tone\n${SMS_VOICE}`);
  }

  if (isContentMode) {
    // ── ESSENTIALS — leanest possible for one strong post ─────────
    // Apr 28 v3 · Dropped from this tier (moved to DEEP):
    //   · SIGNATURE_SERIES (~5kc — nice-to-have, Nick can invent series)
    //   · ALGORITHM_PRIORITIES (~2kc — covered implicitly by master rules
    //     and the engagement language already in CAPTION_ENGINE)
    // Net: was ~33kc essentials, now ~26kc. Pulls content mode to ~67kc
    // total which is just over Venice's 65k limit but workable. DEEP
    // mode adds the dropped sections + strategic/operational stuff.
    // ── FORMAT-SPECIFIC engines — computed first, injected EARLY ──
    // 2026-08-08 · these lived at the essentials TAIL, so under the 65k
    // budget the engine for the ASKED format was the FIRST block dropped
    // ("write me a carousel" lost CAROUSEL ENGINE while keeping generic
    // tail cards — reproduced with the trimmer's own drop order). The
    // ask-specific engine is the highest-value block after the mandatory
    // rules, so it rides directly behind them. Only fires when the
    // message hints a format; saves ~8kc when unspecified.
    const m = userMessage?.toLowerCase() || "";
    const formatBlocks: string[] = [];
    if (/\breel|reels|video|tiktok|shorts?\b/.test(m)) {
      formatBlocks.push(`## REELS ENGINE (formula, length guide, 4 script examples)\n${REELS_ENGINE}`);
    }
    if (/\bcarousel|carousels|slides?|swipe\b/.test(m)) {
      formatBlocks.push(`## CAROUSEL ENGINE (6-slide formula + 2 examples)\n${CAROUSEL_ENGINE}`);
    }
    if (/\bstory|stories|highlight\b/.test(m)) {
      formatBlocks.push(`## STORY ENGINE (daily rotation + stickers + polls + Q&A + DM triggers)\n${STORY_ENGINE}`);
    }

    blocks.push(
      `## ⚠️ CONTENT GENERATION MODE — MANDATORY RULES (read FIRST before writing any caption/post/copy)\n${CONTENT_GENERATION_MODE}`,
      `## PRIME DIRECTIVE — the mental shortcut\n${PRIME_DIRECTIVE}`,
      ...formatBlocks,
      `## CONTENT PILLARS (10 permanent, repetition-controlled)\n${CONTENT_PILLARS}`,
      `## CREATIVE ANGLE MACHINE (10 angle types)\n${CREATIVE_ANGLES}`,
      `## HOOK FAMILIES + HOOK VAULT (with concrete one-liners)\n${HOOK_FAMILIES}`,
      `## CAPTION ENGINE (8-part formula + length rules + examples)\n${CAPTION_ENGINE}`,
      `## VISUAL LAYOUTS (7 winning design templates)\n${VISUAL_LAYOUTS}`,
      `## CTA RULES + DM KEYWORDS\n${CTA_RULES}`,
      `## INSTAGRAM SEO + HASHTAG SYSTEM (with topic-specific sets)\n${IG_SEO_AND_HASHTAGS}`,
      `## DAILY OUTPUT TEMPLATE (14-section format Nick uses for every post)\n${DAILY_OUTPUT_TEMPLATE}`,
      `## NEVER-GENERIC LIST (banned phrases + stronger replacements)\n${NEVER_GENERIC}`,
      `## 20 FINAL MASTER RULES + The Final Standard\n${FINAL_MASTER_RULES}`,
      // 2026-06-10 · moved here from the always-on foundation — both
      // exist to feed content generation (equipment citations in posts;
      // image-anchor rules + rotation vocab). Cross-mode local facts
      // (potholes, Dead Man's Curve, salt season) stay in CUSTOMER_PROFILE.
      `## EQUIPMENT AUTHORITY (concrete proof, not bragging)\n${EQUIPMENT_AUTHORITY}`,
      `## CLEVELAND IDENTITY (local vocab + landmarks)\n${CLEVELAND_IDENTITY}`,
    );

    // ── DEEP — opt-in for planning / strategy / review questions ──
    // Adds 10 Psychology Principles + Conversion System + GBP +
    // Cadence + Daily Rotation + Monthly + 30-Day + 10-post mix +
    // Offer Engine + 5 Traffic Campaigns + Engagement Prompts +
    // First-Hour + Response Scripts + Capture System + Quality +
    // Performance + Paid Boosting + Offline Integration + 90-Day +
    // Success Stack + Review Engine + Ideas Vault.
    if (detectContentDeepIntent(userMessage)) {
      blocks.push(
        `## ALGORITHM PRIORITIES (what Instagram rewards in 2026)\n${ALGORITHM_PRIORITIES}`,
        `## SIGNATURE SERIES (10 named recurring formats)\n${SIGNATURE_SERIES}`,
        `## THE SUCCESS STACK (7 forces compounding daily)\n${SUCCESS_STACK}`,
        `## 10 PSYCHOLOGY PRINCIPLES (Cialdini-grade)\n${PSYCHOLOGY_PRINCIPLES}`,
        `## TRAFFIC-TO-SHOP CONVERSION SYSTEM + CTA LADDER\n${CONVERSION_SYSTEM}`,
        `## REVIEW & REPUTATION ENGINE\n${REVIEW_ENGINE}`,
        `## DIGITAL PRESENCE — GBP + Website + IG profile optimization\n${DIGITAL_PRESENCE}`,
        `## POSTING CADENCE (3 systems)\n${POSTING_CADENCE}`,
        `## DAILY ROTATION (Mon-Sun default rhythm)\n${DAILY_ROTATION}`,
        `## MONTHLY CAMPAIGNS (Jan-Dec themes)\n${MONTHLY_CAMPAIGNS}`,
        `## 30-DAY CONTENT MAP (ready-to-execute month)\n${THIRTY_DAY_MAP}`,
        `## 10-POST CONTENT MIX (balance ratio)\n${TEN_POST_MIX}`,
        `## OFFER ENGINE\n${OFFER_ENGINE}`,
        `## 5 SHOP TRAFFIC CAMPAIGNS (weekly playbooks)\n${TRAFFIC_CAMPAIGNS}`,
        `## ENGAGEMENT PROMPTS (comment / share / save)\n${ENGAGEMENT_PROMPTS}`,
        `## FIRST-HOUR PROTOCOL\n${FIRST_HOUR_PROTOCOL}`,
        `## COMMENT + DM RESPONSE SCRIPTS\n${RESPONSE_SCRIPTS}`,
        `## STREET-TO-SOCIAL CAPTURE SYSTEM + content bank\n${CAPTURE_SYSTEM}`,
        `## QUALITY CONTROL RULES\n${QUALITY_CONTROL}`,
        `## PERFORMANCE SCORING + Weekly + Monthly reviews\n${PERFORMANCE_SYSTEM}`,
        `## PAID BOOSTING SYSTEM\n${PAID_BOOSTING}`,
        `## OFFLINE TRAFFIC INTEGRATION + Community + UGC\n${OFFLINE_INTEGRATION}`,
        `## 90-DAY DOMINANCE PLAN\n${NINETY_DAY_PLAN}`,
        `## IDEAS VAULT (endless raw concepts to remix)\n${IDEAS_VAULT}`,
      );
    }
  }

  return blocks.join("\n\n");
}
