/**
 * Chat pipeline · INTERCEPTORS stage
 *
 * Three deterministic intents bypass the entire model pipeline (no
 * system-prompt build, no embedding, no streamText) and produce a
 * canned SSE response inline:
 *
 *   1. Image generation        — "/img <prompt>" or "make me a picture of …"
 *   2. Decision log             — "log this decision: …" / "decided to …"
 *   3. Brain dump capture       — "remember that …" / "journal: …"
 *
 * Plus three intensity / explicit-save fast paths:
 *
 *   4. /save · /remember · /ingest  → BrainMemory row (heuristic only)
 *   5. /strict · "stay focused"     → minimum-intensity override
 *   6. /chill                       → restore env default intensity
 *
 * Why this lives BEFORE the parallel prefetch:
 *   The prefetch fires buildSystemPrompt + tool-embedding warmup +
 *   conversation compression in parallel. When Venice is rate-
 *   limiting embedding calls, that block can stall 30s+ — even though
 *   none of those results are needed for capturing a thought or
 *   logging a decision. Routing fast-path intents at the top means
 *   "remember that I committed to X" returns in ~200ms, regardless of
 *   downstream provider health.
 *
 * Each handler:
 *   · Creates the conversation if missing
 *   · Persists the user message (so /chat history stays consistent)
 *   · Performs its domain action (image gen / decision row / journal ingest)
 *   · Streams a single text-delta confirmation back as a Vercel AI
 *     UI Message stream (so the existing client renderer "just works")
 *   · Persists the assistant confirmation to ChatMessage as well
 *
 * Returns either:
 *   { kind: "handled", response, convId }  → route returns response
 *   { kind: "pass" }                       → route continues to model pipeline
 *
 * v10.0.529.106 · Wave 86 · this file used to be 1364 LOC with every
 * handler inline. Now lives as the thin dispatcher · classifier ·
 * detection helpers · plus re-exports of the regex constants and
 * handler entry points so external callers + tests see no API change.
 * The actual handler bodies + the SSE bootstrap utilities live under
 * lib/ai/chat/handlers/.
 */

import { prisma } from "@/lib/prisma";
import { setIntensityOverride } from "../knowledge/behavior-directive";

// Detection regexes + the SSE/bootstrap helpers live in handlers/
// (next to the handlers that strip those prefixes) so the static
// import graph stays acyclic. Re-export the public surface so
// callers continue to import everything from @/lib/ai/chat/interceptors.
import {
  EARLY_NL_IMAGE_VERB,
  EARLY_NL_IMAGE_NOUN,
  EARLY_NL_IMAGE,
  EARLY_IMAGE_NEG,
  EARLY_IDEATION_NEG,
  EARLY_DECISION,
  EARLY_BRAIN_DUMP,
  EARLY_STRICT,
  EARLY_CHILL,
  EARLY_SLASH_SAVE,
  EARLY_IMAGE_FOLLOWUP,
  MULTI_OPTION_CLARIFICATION_RE,
} from "./handlers/patterns";
import { buildFastStream, ensureConvAndPersistUser } from "./handlers/shared";
import { handleImage } from "./handlers/image";
import { handleDecision } from "./handlers/decision";
import { handleBrainDump, handleSlashSave } from "./handlers/brain-dump";
import { isRedeliveryRequest } from "./redelivery";
// F5 operator command shortcuts (/today, /rescue, /what-changed, /import-session,
// /receipts, /stale). resolveCommand/runCommand are the SAME registry the
// /api/system/command endpoint uses — no duplicated command logic.
import { resolveCommand, runCommand } from "./command-registry";

export {
  EARLY_NL_IMAGE_VERB,
  EARLY_NL_IMAGE_NOUN,
  EARLY_NL_IMAGE,
  EARLY_IMAGE_NEG,
  EARLY_IDEATION_NEG,
  EARLY_DECISION,
  EARLY_BRAIN_DUMP,
  EARLY_STRICT,
  EARLY_CHILL,
  EARLY_SLASH_SAVE,
  EARLY_IMAGE_FOLLOWUP,
  MULTI_OPTION_CLARIFICATION_RE,
};
export { handleImage, handleDecision, handleBrainDump, handleSlashSave };

export interface InterceptArgs {
  userContent: string;
  lastUserMsg: Record<string, unknown> & { role?: string };
  convId: string | undefined;
}

export type InterceptResult =
  | { kind: "handled"; response: Response; convId: string }
  | { kind: "pass" };

/**
 * v10.0.142 · May 02 · Long-knowledge-dump detector.
 *
 * Pre-fix · Nour pasted a 2,000-char Nick's Tire & Auto Brand Style
 * Blueprint (with sections, headers, "SECTION 1 — BRAIN CORE",
 * etc.). The doc inevitably mentioned "design", "visual", "graphic",
 * "illustration" while DESCRIBING the brand's visual style — not
 * REQUESTING image generation. The verb+noun conjunction in
 * EARLY_NL_IMAGE_VERB + EARLY_NL_IMAGE_NOUN tripped, the chat
 * routed to handleImage(), and Nour saw "Generating image…" + a
 * Venice 400 size error instead of an ingest acknowledgment.
 *
 * The fix · long, structured input is almost never an image
 * generation request. Genuine image asks are short and direct:
 *   "make me a brake post" (24 chars)
 *   "/image cyberpunk car" (slash command)
 *   "use Banana to make a logo" (33 chars)
 * Knowledge dumps look like:
 *   - Multi-paragraph (≥3 newlines)
 *   - Or section markers (SECTION, ##, EXECUTIVE SUMMARY, BRAND CORE)
 *   - And > 600 chars total
 *
 * When this pattern matches, nlImage is forced false in
 * classifyIntercept regardless of verb/noun matches. The user can
 * still force image gen with /img or /image — those are explicit and
 * don't need protection from misclassification.
 */
export function isLongKnowledgeDump(content: string): boolean {
  const text = content.trim();
  if (text.length < 600) return false;
  // Multi-paragraph structure (3+ newline separators)
  const newlineCount = (text.match(/\n/g) || []).length;
  if (newlineCount >= 3) return true;
  // Explicit section / executive-doc markers
  if (
    /\b(SECTION\s+\d|EXECUTIVE\s+SUMMARY|BRAND\s+CORE|TABLE\s+OF\s+CONTENTS|##\s+\w|^\s*#\s+\w)/im.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

export interface InterceptKind {
  slashImage: boolean;
  nlImage: boolean;
  decision: boolean;
  brainDump: boolean;
  slashSave: boolean;
  strict: boolean;
  chill: boolean;
  /** 2026-08-18 · "resend that" / "app bugged, retry" — re-serve the
   *  stored last assistant text deterministically (see redelivery.ts:
   *  the prompt rule measurably failed; the model regenerates). */
  redelivery: boolean;
  any: boolean;
}

/**
 * Pure classifier — exported for testing. No side effects, no DB
 * reads. Decides whether the user's last message should bypass the
 * model pipeline and which fast path to take.
 *
 * `previousAssistantWasImage` (optional) lets the caller signal that
 * the prior turn produced an image, so terse follow-ups like
 * "another one" / "switch it up" trip the image fast path.
 */
export function classifyIntercept(
  userContent: string,
  previousAssistantWasImage = false,
): InterceptKind {
  const lower = userContent.trim().toLowerCase();
  const slashImage =
    lower.startsWith("/img ") ||
    lower.startsWith("/image ") ||
    lower.startsWith("/picture ") ||
    lower === "/img" ||
    lower === "/image" ||
    lower === "/picture";
  // v10.0.142 · long knowledge dumps are NEVER nl image requests.
  // They contain verb+noun matches incidentally because they describe
  // visual style. Slash commands still bypass this guard because they
  // express explicit intent.
  const knowledgeDump = !slashImage && isLongKnowledgeDump(userContent);
  // Apr 27 — use the conjunction matcher (verb anywhere + noun anywhere)
  // so "use nano banana to make me a simple image of X" trips the fast
  // path. The legacy template-based EARLY_NL_IMAGE is kept as a fallback
  // for the rare case where the wording is so tight it slips by the
  // looser pair (still cheap to test both).
  const nlImageDirect =
    !slashImage &&
    !knowledgeDump &&
    !EARLY_IMAGE_NEG.test(userContent) &&
    !EARLY_IDEATION_NEG.test(userContent) &&
    ((EARLY_NL_IMAGE_VERB.test(userContent) &&
      EARLY_NL_IMAGE_NOUN.test(userContent)) ||
      EARLY_NL_IMAGE.test(userContent));
  // Followup: short continuation phrasing only triggers image gen when
  // the prior turn was an image. Avoids "again" hijacking text replies.
  const nlImageFollowup =
    !slashImage &&
    previousAssistantWasImage &&
    EARLY_IMAGE_FOLLOWUP.test(userContent.trim());
  const nlImage = nlImageDirect || nlImageFollowup;
  const decision = EARLY_DECISION.test(userContent.trim());
  const brainDump = EARLY_BRAIN_DUMP.test(userContent.trim());
  const slashSave = EARLY_SLASH_SAVE.test(userContent.trim());
  const strict = EARLY_STRICT.test(userContent.trim());
  const chill = EARLY_CHILL.test(userContent.trim());
  // 2026-08-18 · re-delivery is suppressed when the prior turn was an
  // image: "send it again" there belongs to the image follow-up path
  // (which regenerates), not to text re-serving.
  const redelivery =
    !previousAssistantWasImage && !nlImage && !slashImage && isRedeliveryRequest(userContent);
  return {
    slashImage,
    nlImage,
    decision,
    brainDump,
    slashSave,
    strict,
    chill,
    redelivery,
    any:
      slashImage ||
      nlImage ||
      decision ||
      brainDump ||
      slashSave ||
      strict ||
      chill ||
      redelivery,
  };
}

// ── Edit-existing-image detection ────────────────────────────────
// "enhance this", "edit this logo", "improve the photo I just sent",
// "upscale this", "fix this image", "make it sexier" — patterns that
// imply the user attached or is about to attach a reference image.
// When this fires AND no image is attached, we ask instead of fabricating.
const EDIT_EXISTING_IMAGE = /\b(enhance|enchance|edit|retouch|fix|upscale|improve|tweak|adjust|clean\s+up|sharpen|recolor|restore)\s+(this|the|that|my|it|these|those|attached|uploaded|the\s+(image|picture|pic|photo|logo))\b/i;
const MAKE_IT_BETTER = /\b(make|making)\s+(it|this|that|the\s+(image|pic|photo|logo))\s+(sexier|better|cleaner|sharper|brighter|prettier|nicer|more)\b/i;
const REFERENT_TO_PRIOR_IMAGE = /\b(this|that|the|my)\s+(logo|image|picture|pic|photo|graphic|design)\s+(from|that|i|we)\b/i;

export function isEditExistingImageRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return EDIT_EXISTING_IMAGE.test(t) || MAKE_IT_BETTER.test(t) || REFERENT_TO_PRIOR_IMAGE.test(t);
}

// ── Multi-option-prior detection · v10.0.511 fix ─────────────────
//
// The 2026-05-12 smoke test exposed an auto-image-fire bug: when the
// prior assistant turn presented MULTIPLE options (e.g. "Post 1 · used
// tires" vs "Post 2 · alignment") and the operator said "now generate
// the picture" without specifying which, the synth grabbed the most
// recent assistant content blob and fired image-gen on that ·
// committing the operator to a draft they hadn't chosen.
//
// This pair detects:
//   priorTurnHadMultipleOptions(content) — the assistant offered ≥2
//     numbered/lettered/headlined alternatives
//   userReferenceIsAmbiguous(text) — user's "generate the picture"
//     style request DOESN'T name which option (no "option 1" / "the
//     first one" / "the used tires one" / etc.)
//
// When BOTH are true · the chat route asks "which one?" instead of
// auto-firing.

/** Match assistant content that presents multiple labelled options. */
const MULTI_OPTION_MARKERS: RegExp[] = [
  /\b(option|post|idea|draft|version|variant|choice|alternative|take)\s*\d+\b/i,
  /\b(option|post|idea|draft|version|variant)\s*(one|two|three|a|b|c)\b/i,
  /^\s*[*\-\d.]+\s*\*?\*?(option|post|idea|draft|version|variant)\s*\d+\b/im,
  // Header-style "Option 1:" / "**Post 1**" / "Idea #1:"
  /\*\*\s*(option|post|idea|draft|version|variant)\s*#?\s*\d+\s*[:.\s]/i,
];

export function priorTurnHadMultipleOptions(priorAssistantText: string | null | undefined): boolean {
  if (!priorAssistantText) return false;
  const text = priorAssistantText;
  // Need ≥2 distinct option markers to count · single "Option 1" doesn't
  // mean multi-option (could be the only option presented).
  let hits = 0;
  for (const pat of MULTI_OPTION_MARKERS) {
    const matches = text.match(new RegExp(pat.source, pat.flags.includes("g") ? pat.flags : pat.flags + "g"));
    hits += matches?.length ?? 0;
    if (hits >= 2) return true;
  }
  return false;
}

/** Match user text that DOES specify which option. Returns true if specific. */
const SPECIFIC_OPTION_REFERENCE: RegExp[] = [
  /\b(option|post|idea|draft|version|variant|choice|alternative|take)\s*(\d+|one|two|three|first|second|third|a|b|c)\b/i,
  /\b(the\s+)?(first|second|third|last|previous|earlier|other|alignment|used\s+tires?|brake|tire|oil|service|review)\s+(one|option|post|idea|draft)\b/i,
  /\b(use\s+the\s+|do\s+the\s+|go\s+with\s+the\s+|pick\s+the\s+|i\s+want\s+the\s+|the\s+)\w+\s+(one|option|post|idea|draft|version)\b/i,
  // Direct subject match · "the brakes one" / "the storefront one"
  /\bthe\s+\w+\s+one\b/i,
];

export function userReferenceIsAmbiguous(userText: string): boolean {
  if (!userText) return true; // empty = ambiguous
  for (const pat of SPECIFIC_OPTION_REFERENCE) {
    if (pat.test(userText)) return false; // user named which
  }
  return true; // no specific reference found
}

/**
 * Gate · should we ASK which option instead of auto-firing image-gen?
 * Returns the clarification text if yes, null if auto-fire is safe.
 */
export function multiOptionImageClarification(
  userContent: string,
  priorAssistantContent: string | null | undefined,
): string | null {
  if (!priorTurnHadMultipleOptions(priorAssistantContent)) return null;
  if (!userReferenceIsAmbiguous(userContent)) return null;
  return (
    "Which one do you want imaged? Your last turn had a few options · " +
    "tell me which (e.g. 'the used-tires post', 'option 1', 'the alignment one') " +
    "and I'll generate the image for that specific draft."
  );
}

// ── Image attachment detection ───────────────────────────────────
// AI SDK v6 stores image attachments in `parts: [{ type: "file",
// mediaType: "image/*", url: "data:..." }]`. v4/v5 used `{ type:
// "image", image: ... }`. Old multimodal shape used `content` array.
// Cover all three to be safe.
export function hasImageAttachment(msg: Record<string, unknown> & { role?: string }): boolean {
  if (!msg) return false;
  const parts = (msg.parts as Array<Record<string, unknown>> | undefined) ?? [];
  for (const p of parts) {
    if (!p) continue;
    if (p.type === "image") return true;
    if (p.type === "file") {
      const media = (p.mediaType ?? p.mimeType) as string | undefined;
      if (typeof media === "string" && media.startsWith("image/")) return true;
    }
  }
  // v4/v5 multimodal content array fallback
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c && typeof c === "object") {
        const co = c as Record<string, unknown>;
        if (co.type === "image" || co.type === "image_url") return true;
      }
    }
  }
  return false;
}

/**
 * Top-level entry point. Returns a handled Response when a fast path
 * matches; returns { kind: "pass" } when the route should continue
 * with the full model pipeline.
 *
 * Apr 27 — pulls the most recent assistant message from the
 * conversation (when convId exists) so terse follow-ups like
 * "another one" / "switch it up" trip the image fast path when the
 * prior turn was an image. Single indexed query, ~5ms — cheaper than
 * the LLM round-trip we'd otherwise waste.
 */
export async function runInterceptors(
  args: InterceptArgs,
): Promise<InterceptResult> {
  // ── F5 operator command shortcuts ──────────────────────────────────
  // /today /rescue /what-changed /import-session /receipts /stale → run the
  // F5 command registry and stream its concise text back. EXACT-match only
  // (resolveCommand.command !== null), so existing slash commands (/save, /img,
  // /chill, …) and unrelated input fall straight through to the model pipeline —
  // no hijacking, no chat-route rewrite, no duplicated command logic.
  if (resolveCommand(args.userContent).command) {
    const commandConvId = await ensureConvAndPersistUser(
      args.convId,
      args.userContent,
      args.lastUserMsg,
    );
    const outcome = await runCommand(args.userContent);
    return {
      kind: "handled",
      response: await buildFastStream(
        commandConvId,
        outcome.result.text,
        "command",
        `cmd:${outcome.command ?? "unknown"}`,
      ),
      convId: commandConvId,
    };
  }

  // Cheap context lookup: was the last assistant turn an image gen?
  // If yes, the classifier accepts "another one"/"again"/"switch it up"
  // as image follow-ups. Skipped when there's no convId (first turn).
  //
  // Apr 27 v2 · Also pulls the prior assistant CONTENT and the prior
  // user message — both feed the image-prompt synthesizer in handleImage
  // so referential asks ("now generate the picture") can be turned into
  // real visual descriptions instead of going to Venice as 4 dead words.
  let previousAssistantWasImage = false;
  let priorAssistantContent: string | null = null;
  let priorUserContent: string | null = null;
  if (args.convId && args.convId !== "temp") {
    try {
      // Pull last 5 assistant turns + last user turn. We need to look back
      // past image-gen results to find the actual TEXT context — when the
      // user says "now generate the picture" right after another image, we
      // want the original tire-safety post as priorAssistantContent, not
      // the prior image-gen marker.
      const [recentAssistants, priorUser] = await Promise.all([
        prisma.chatMessage.findMany({
          where: { conversationId: args.convId, role: "assistant" },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { model: true, content: true },
        }),
        prisma.chatMessage.findFirst({
          where: { conversationId: args.convId, role: "user" },
          orderBy: { createdAt: "desc" },
          select: { content: true },
        }),
      ]);
      const mostRecent = recentAssistants[0];
      if (mostRecent) {
        // v10.0.333 · accept BOTH legacy venice-image rows AND new gpt-
        // image-1 rows (model = "gpt-image-1"). The markdown-image regex
        // catches anything we miss · all image-gen rows render with
        // ![Generated Image](/api/images/...) regardless of provider.
        //
        // v10.0.513 · ALSO accept the multi-option-image-clarification
        // message · "Which one do you want imaged?". When that's the
        // most recent assistant turn, the user's next message ("the
        // technicians one" / "option 2") is a follow-up to the
        // clarification and should route to image-gen via the
        // EARLY_IMAGE_FOLLOWUP fast path (which v10.0.513 also
        // extends to match option-reference phrases).
        previousAssistantWasImage =
          mostRecent.model === "venice-image" ||
          mostRecent.model === "gpt-image-1" ||
          /\!\[Generated Image\]\(\/api\/images\//.test(mostRecent.content || "") ||
          MULTI_OPTION_CLARIFICATION_RE.test(mostRecent.content || "");
      }
      // Find the most recent TEXT assistant turn (not image-gen) for synth context.
      // v10.0.513 · also skip the multi-option clarification message itself
      // so synth pulls the real post-drafts content from the turn BEFORE
      // the clarification.
      const lastText = recentAssistants.find(
        (m) =>
          m.model !== "venice-image" &&
          m.model !== "venice-image-error" &&
          m.model !== "gpt-image-1" &&
          m.model !== "openai-image-error" &&
          !/\!\[Generated Image\]\(\/api\/images\//.test(m.content || "") &&
          !MULTI_OPTION_CLARIFICATION_RE.test(m.content || "") &&
          (m.content?.length ?? 0) > 50, // skip stub replies
      );
      priorAssistantContent = lastText?.content || mostRecent?.content || null;
      if (priorUser) {
        priorUserContent = priorUser.content || null;
      }
    } catch (err) {
      // non-fatal — just means follow-ups won't fire and synth won't run
      void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.chat.interceptors", err, { fn: "runInterceptors.contextFetch" }, "warn"));
    }
  }
  const intent = classifyIntercept(args.userContent, previousAssistantWasImage);
  if (!intent.any) return { kind: "pass" };

  // 2026-08-18 · re-delivery with nothing to re-deliver (first turn, or
  // no stored assistant text) must fall through to the model BEFORE any
  // persistence side effects — the model pipeline persists the user
  // message itself.
  if (
    intent.redelivery &&
    !priorAssistantContent &&
    !(intent.slashImage || intent.nlImage || intent.decision || intent.brainDump || intent.slashSave || intent.strict || intent.chill)
  ) {
    return { kind: "pass" };
  }

  const convId = await ensureConvAndPersistUser(
    args.convId,
    args.userContent,
    args.lastUserMsg,
  );

  if (intent.redelivery && priorAssistantContent) {
    // Deterministic re-serve of the stored last assistant text — no
    // model call, no drift. See lib/ai/chat/redelivery.ts for why the
    // prompt-rule approach measurably failed here.
    return {
      kind: "handled",
      response: await buildFastStream(
        convId,
        priorAssistantContent,
        "redelivery",
        "retry-redelivery",
      ),
      convId,
    };
  }

  if (intent.slashImage || intent.nlImage) {
    // v7 · Apr 28 · Missing-image attachment guard. When the user says
    // "enhance THIS / edit THIS / make IT sexier / upscale THIS" but
    // they didn't actually attach an image (forgot, upload failed, etc),
    // generating a brand-new fabricated image is a worse experience than
    // saying so honestly. Detect the pattern + ask once.
    const looksLikeEditExisting = isEditExistingImageRequest(args.userContent);
    if (looksLikeEditExisting && !hasImageAttachment(args.lastUserMsg)) {
      const guidance = `I don't see an image attached — did your upload finish? \n\nIf you wanted me to edit a specific image, drag it into the chat (or use the paperclip) and re-send the request. Otherwise, describe what you want and I'll generate fresh.`;
      return {
        kind: "handled",
        response: await buildFastStream(convId, guidance, "img-noattach", "image-edit-no-attachment"),
        convId,
      };
    }

    // v10.0.511 · multi-option-prior gate. When the prior assistant turn
    // offered ≥2 labelled options (Post 1 vs Post 2, Option 1 vs Option
    // 2, etc.) and the user's image request doesn't name WHICH option,
    // ASK before committing them to a draft they hadn't chosen. Caught
    // by the 2026-05-12 smoke test: operator was browsing 2 post drafts,
    // said "now generate the picture", system grabbed the last assistant
    // blob and fired image-gen on the used-tires draft they hadn't yet
    // committed to.
    //
    // Slash-image (/img "explicit prompt") bypasses this · they typed a
    // direct prompt, intent is unambiguous.
    if (intent.nlImage && !intent.slashImage) {
      const clarification = multiOptionImageClarification(
        args.userContent,
        priorAssistantContent,
      );
      if (clarification) {
        return {
          kind: "handled",
          response: await buildFastStream(
            convId,
            clarification,
            "img-multioption-gate",
            "image-multi-option-gate",
          ),
          convId,
        };
      }
    }

    return {
      kind: "handled",
      response: await handleImage(
        convId,
        args.userContent,
        intent.slashImage,
        priorAssistantContent,
        priorUserContent,
      ),
      convId,
    };
  }
  if (intent.decision) {
    return {
      kind: "handled",
      response: await handleDecision(convId, args.userContent),
      convId,
    };
  }
  if (intent.brainDump) {
    return {
      kind: "handled",
      response: await handleBrainDump(convId, args.userContent),
      convId,
    };
  }
  if (intent.slashSave) {
    return {
      kind: "handled",
      response: await handleSlashSave(convId, args.userContent),
      convId,
    };
  }
  if (intent.strict) {
    setIntensityOverride("MINIMAL");
    return {
      kind: "handled",
      response: await buildFastStream(convId, "Strict mode ON. Every message from now is direct answer only — no elevation, no suggestions. Say `/chill` to restore normal intensity.", "intensity", "fast-path"),
      convId,
    };
  }
  if (intent.chill) {
    setIntensityOverride(null); // restore env default
    return {
      kind: "handled",
      response: await buildFastStream(convId, "Chill mode ON. Normal elevation restored. Say `/strict` to suppress elevation.", "intensity", "fast-path"),
      convId,
    };
  }

  // Unreachable — intent.any is true so one of the matched.
  return { kind: "pass" };
}

