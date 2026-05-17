/**
 * AUTO-FIRE GATE — decides whether to auto-inject "now generate the picture"
 * AND extracts the plan card the toast component renders.
 *
 * v6 · Apr 28 — Replaces the silent auto-fire useEffect from chat/page.tsx.
 * Returns a structured decision so the UI can show a Plan Card with
 * Go/Edit/Cancel buttons before actually firing.
 *
 * Layered checks (each kills auto-fire):
 *   1. Reply must hit looksLikeMarketingContent threshold (signal + hard requirement).
 *   2. User's prompt must pass detectContentIntent — they ASKED for content.
 *   3. User's last message must NOT have an image attached — they uploaded
 *      something to talk about, not to generate around.
 *   4. User's prompt must NOT be an opinion/review question.
 *   5. The reply must NOT already contain a generated image.
 *   6. The previous user message must NOT itself be a "generate again" ask
 *      (defense vs. infinite loop).
 *
 * If all pass → returns { fire: true, plan: { subject, format, angle, ... } }.
 * If any fails → returns { fire: false, reason }.
 */

import {
  looksLikeMarketingContent,
  alreadyHasGeneratedImage,
  isOpinionOrReviewQuestion,
} from "./marketing-detection";

export interface AutoFirePlan {
  /** Subject extracted from user prompt + reply context (e.g. "brakes", "winter tires") */
  subject: string;
  /** Detected format hint (e.g. "4:5 instagram", "9:16 story", "landscape billboard") */
  format: string;
  /** Persuasion angle inferred from reply structure (pain / proof / scarcity / alert) */
  angle: string;
  /** Brand styling (always Nick's Tire) */
  brand: string;
  /** Best speed mode for this ask (fast for drafts, balanced for default, quality for premium) */
  speed: "fast" | "balanced" | "quality";
  /** Confidence 0-1 in the plan being right (lower = ambiguous, higher = explicit) */
  confidence: number;
  /** Concrete prompt the image gen will use (caller can edit before firing) */
  imagePrompt: string;
}

export interface AutoFireDecision {
  fire: boolean;
  reason: string;
  /** Always populated when fire=true. Optional when fire=false (debug). */
  plan?: AutoFirePlan;
}

interface UserMessagePart {
  type: string;
  text?: string;
  // Image attachment shapes vary across AI SDK versions
  image?: unknown;
  url?: string;
  mediaType?: string;
  data?: string;
}

/**
 * True if the user's message had an image attachment in any form.
 * The AI SDK v6 supports several shapes — we check them all.
 */
export function userMessageHasImage(parts: UserMessagePart[] | undefined): boolean {
  if (!parts || !Array.isArray(parts)) return false;
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const type = String(p.type ?? "");
    // Various AI SDK part shapes for images
    if (type === "image" || type === "file" || type === "image_url") return true;
    if (type.startsWith("image/")) return true;
    // Some SDKs wrap images as { type: "text", text: "data:image/..." }
    if (type === "text" && typeof p.text === "string" && /^data:image\//.test(p.text.slice(0, 30))) {
      return true;
    }
    // image_url part shape
    if ((p as { image_url?: unknown }).image_url) return true;
    // raw data field with mediaType image
    if (p.mediaType && p.mediaType.startsWith("image/")) return true;
  }
  return false;
}

/**
 * Subject extraction (G — smarter). Tries:
 *   1. Service-specific keyword in user prompt (most reliable)
 *   2. Service-specific keyword in reply (next-best)
 *   3. Generic fallback "tires" (last resort)
 *
 * Returns a single noun phrase suitable for image-prompt subject.
 */
function extractSubject(userPrompt: string, replyText: string): { subject: string; confidence: number } {
  const p = userPrompt.toLowerCase();
  const r = replyText.toLowerCase();

  // Tier 1 — explicit service mention in USER prompt
  const userMatch = matchService(p);
  if (userMatch) return { subject: userMatch, confidence: 0.95 };

  // Tier 2 — service mention in REPLY (Nick may have inferred it)
  const replyMatch = matchService(r);
  if (replyMatch) return { subject: replyMatch, confidence: 0.7 };

  // Tier 3 — generic fallback
  return { subject: "Nick's Tire & Auto shop", confidence: 0.3 };
}

function matchService(text: string): string | null {
  const services: Array<[RegExp, string]> = [
    [/\b(brake|rotor|caliper|pad)s?\b/, "brakes"],
    [/\b(alignment|wheel\s+align)/, "wheel alignment"],
    [/\b(tire|tyre|tread)s?\b/, "tires"],
    [/\b(winter\s+tire|snow\s+tire)/, "winter tires"],
    [/\b(summer\s+tire|all-season)/, "summer tires"],
    [/\b(oil\s+change|engine\s+oil)/, "oil change"],
    [/\b(rotation|tire\s+rotation)/, "tire rotation"],
    [/\b(diagnostic|engine\s+light|check\s+engine)/, "diagnostics"],
    [/\b(battery|alternator|starter)/, "battery service"],
    [/\b(transmission|trans\s+fluid)/, "transmission service"],
    [/\b(suspension|strut|shock)/, "suspension"],
    [/\b(coolant|radiator|antifreeze)/, "cooling system"],
    [/\b(filter|air\s+filter|cabin\s+filter)/, "filters"],
    [/\b(belt|serpentine|timing\s+belt)/, "belts"],
    [/\b(spark\s+plug|ignition)/, "tune-up"],
    [/\b(ac|a\/c|air\s+condition)/, "A/C service"],
    [/\b(inspection|safety\s+check)/, "safety inspection"],
  ];
  for (const [re, label] of services) {
    if (re.test(text)) return label;
  }
  return null;
}

/**
 * Format hint — read both prompt + reply for IG/FB/story/billboard cues.
 */
function extractFormat(userPrompt: string, replyText: string): string {
  const all = `${userPrompt} ${replyText}`.toLowerCase();
  if (/\b(reel|reels|tiktok|short|9:16|vertical)/.test(all)) return "9:16 reel/story";
  if (/\b(story|stories)/.test(all)) return "9:16 story";
  if (/\b(carousel|swipe|slide)/.test(all)) return "1:1 carousel slide";
  if (/\b(billboard|banner|landscape|16:9|hero)/.test(all)) return "16:9 banner";
  if (/\b(facebook\s+post|fb\s+post)/.test(all)) return "1:1 Facebook";
  if (/\b(instagram\s+post|ig\s+post|gram)/.test(all)) return "4:5 Instagram";
  return "4:5 Instagram"; // default for static post
}

/**
 * Angle inference from reply structure — what persuasion lever did
 * Nick land on? Determines image mood (urgent vs reassuring).
 */
function extractAngle(replyText: string): string {
  const r = replyText.toLowerCase();
  if (/\b(alert|⚠️|warning|don'?t miss|act now)/.test(r)) return "alert/urgent";
  if (/\b(only|left|spots|limited|today only|while supplies)/.test(r)) return "scarcity";
  if (/\b(saved|fixed|brought (in|me)|customer|s\.\s+|\bj\.\s+)/i.test(r)) return "social-proof/customer-story";
  if (/\b(myth|truth is|most shops|actually|fact)/.test(r)) return "myth-busting";
  if (/\b(noise|grinding|wobble|leak|vibration|stuck)/.test(r)) return "pain/problem";
  return "value/utility"; // default educational
}

/**
 * Speed inference — fast for drafts/iteration, quality for billboard/HD.
 */
function extractSpeed(userPrompt: string): "fast" | "balanced" | "quality" {
  const p = userPrompt.toLowerCase();
  if (/\b(turbo|fast|quick|draft|preview|rough|sketch|cheap)\b/.test(p)) return "fast";
  if (/\b(billboard|premium|max\s+quality|magazine|paid\s+ad|highest\s+quality)\b/.test(p)) return "quality";
  return "balanced";
}

/**
 * Master decision function — runs all gates + returns plan if fire=true.
 */
export function decideAutoFire(args: {
  userPrompt: string;
  userMessageParts?: UserMessagePart[];
  replyText: string;
}): AutoFireDecision {
  const { userPrompt, userMessageParts, replyText } = args;

  // Gate 5 — already has image
  if (alreadyHasGeneratedImage(replyText)) {
    return { fire: false, reason: "reply already has a generated image" };
  }

  // Gate 6 — previous user prompt was itself a "generate again" follow-up
  if (
    /\b(generate|make|create|draw)\s+(me\s+)?(an?\s+|the\s+)?(image|picture|pic|photo)/i.test(userPrompt) ||
    /^(another|again|one more|switch it up|new one|do that|make that)/i.test(userPrompt.trim())
  ) {
    return { fire: false, reason: "user already asked for image directly — interceptor handles" };
  }

  // Gate B — image attachment hard rule
  if (userMessageHasImage(userMessageParts)) {
    return { fire: false, reason: "user attached an image — conversation is about that image" };
  }

  // Gate 4 — opinion / review question
  if (isOpinionOrReviewQuestion(userPrompt)) {
    return { fire: false, reason: "user asked an opinion/review question, not content" };
  }

  // Gate A — user-intent gate (must be content-asking)
  // Lazy import to avoid bundling content-intent into the chat-page client bundle
  // unnecessarily — only loaded when an auto-fire candidate appears.
  const { detectContentIntentSync } = require("@/lib/ai/content-intent") as typeof import("@/lib/ai/content-intent");
  const intent = detectContentIntentSync(userPrompt);
  if (!intent.isContent) {
    return {
      fire: false,
      reason: `user prompt isn't content (confidence=${intent.confidence.toFixed(2)})`,
    };
  }

  // Gate 1 — reply must look like marketing content (with userPrompt context)
  if (!looksLikeMarketingContent(replyText, userPrompt)) {
    return { fire: false, reason: "reply doesn't hit marketing-content threshold" };
  }

  // All gates passed — build the plan
  const { subject, confidence: subjectConfidence } = extractSubject(userPrompt, replyText);
  const format = extractFormat(userPrompt, replyText);
  const angle = extractAngle(replyText);
  const speed = extractSpeed(userPrompt);
  const brand = "Nick's Tire & Auto · gold #FDB913 on black";

  const imagePrompt = buildImagePrompt({ subject, format, angle, brand });

  return {
    fire: true,
    reason: "all gates passed",
    plan: {
      subject,
      format,
      angle,
      brand,
      speed,
      confidence: Math.min(intent.confidence, subjectConfidence, 1),
      imagePrompt,
    },
  };
}

function buildImagePrompt(args: {
  subject: string;
  format: string;
  angle: string;
  brand: string;
}): string {
  const { subject, format, angle, brand } = args;
  const moodMap: Record<string, string> = {
    "alert/urgent": "urgent, attention-grabbing, bold contrast",
    scarcity: "limited, exclusive, premium feel",
    "social-proof/customer-story": "warm, authentic, real-shop atmosphere",
    "myth-busting": "clean, authoritative, infographic-friendly",
    "pain/problem": "diagnostic, slightly tense, problem-solving energy",
    "value/utility": "clear, informative, professional",
  };
  const mood = moodMap[angle] ?? "professional, clean";
  return `${subject} for ${brand}, ${format} format, ${mood}. Clean professional automotive photography, gold accents on dark background, Cleveland independent auto shop aesthetic.`;
}
