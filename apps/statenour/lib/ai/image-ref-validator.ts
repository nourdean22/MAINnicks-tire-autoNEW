/**
 * Image-reference validator
 *
 * Apr 27 · The venice-uncensored model has no function calling, so
 * when it sees prior assistant turns containing
 *   ![Generated Image](/api/images/<id>)
 * markdown, it pattern-matches and emits NEW image markdown with
 * fabricated cuid-shaped IDs. Those IDs don't exist in audit_events
 * and the image route 404s.
 *
 * Server-side mitigations are layered:
 *   1. The chat-pipeline interceptor catches "make me an image of X"
 *      asks BEFORE the model runs. Real Venice image gen happens,
 *      real ID stored, real URL streamed. (lib/ai/chat/interceptors.ts)
 *   2. The system prompt explicitly forbids the model from writing
 *      `![](/api/images/...)` markdown. (lib/ai/system-prompt.ts)
 *   3. THIS validator — runs in the chat route's onFinish, BEFORE
 *      persisting the assistant message to chat_messages. Any
 *      `/api/images/<id>` that doesn't resolve in audit_events gets
 *      replaced with a clear error block, so:
 *        a) the persisted history reads honestly
 *        b) future turns won't pattern-match on broken markdown and
 *           perpetuate the hallucination
 *        c) the user sees what actually happened
 *
 * Pure async helper. No React, no Next.js — testable.
 */

import { prisma } from "@/lib/prisma";

const IMAGE_URL_PATTERN = /\/api\/images\/([a-z0-9_-]{8,})/gi;
// Wider match for the full markdown line so we can swap the entire
// `![label](url)` block. Captures: 1=alt label, 2=image id.
// 2026-09-07 (D13) · tolerate a signed `?exp=&sig=` suffix; the id capture is unchanged.
const IMAGE_MARKDOWN_PATTERN = /!\[([^\]]*)\]\(\/api\/images\/([a-z0-9_-]{8,})(?:\?[^)\s]*)?\)/gi;

export interface ImageValidationResult {
  /** Text with broken `![](url)` blocks replaced by an inline error. */
  cleaned: string;
  /** Total `/api/images/<id>` references found in input. */
  found: number;
  /** Subset that resolved in audit_events. */
  valid: number;
  /** Subset that did NOT resolve — these are hallucinated. */
  ghosts: number;
  /** The ghost IDs (for logging). */
  ghostIds: string[];
}

/**
 * Walk every `/api/images/<id>` reference in `text`, batch-check the
 * IDs against the audit_events table, and rewrite the markdown for
 * any ghost. Non-markdown references (bare URLs in a sentence) get
 * left alone — they don't render as broken thumbnails so they're
 * not actively misleading.
 *
 * Returns the cleaned text plus counts so the caller can log when
 * the model is hallucinating.
 */
export async function validateImageReferences(
  text: string,
): Promise<ImageValidationResult> {
  if (!text) {
    return { cleaned: "", found: 0, valid: 0, ghosts: 0, ghostIds: [] };
  }

  // First pass — collect every unique ID referenced.
  const ids = new Set<string>();
  for (const match of text.matchAll(IMAGE_URL_PATTERN)) {
    if (match[1]) ids.add(match[1]);
  }

  if (ids.size === 0) {
    return { cleaned: text, found: 0, valid: 0, ghosts: 0, ghostIds: [] };
  }

  // Single batched DB query — N=1 round-trip regardless of how many
  // IDs the model fabricated. Filter to eventType so a coincidental
  // matching audit_event of a different type doesn't false-positive.
  let validIds = new Set<string>();
  try {
    const rows = await prisma.auditEvent.findMany({
      where: {
        id: { in: [...ids] },
        eventType: "generated_image",
      },
      select: { id: true },
    });
    validIds = new Set(rows.map((r) => r.id));
  } catch (err) {
    // DB error → fail open. Don't strip valid markdown just because
    // we couldn't validate. Worst case the user sees the same broken
    // thumbnail they would've seen anyway.
    console.warn(
      "[image-ref-validator] DB check failed, skipping validation:",
      err instanceof Error ? err.message : err,
    );
    return {
      cleaned: text,
      found: ids.size,
      valid: 0,
      ghosts: 0,
      ghostIds: [],
    };
  }

  const ghostIds = [...ids].filter((id) => !validIds.has(id));
  if (ghostIds.length === 0) {
    return {
      cleaned: text,
      found: ids.size,
      valid: validIds.size,
      ghosts: 0,
      ghostIds: [],
    };
  }

  // Second pass — rewrite the full markdown blocks for ghost IDs only.
  // Valid IDs are left untouched.
  const ghostSet = new Set(ghostIds);
  const cleaned = text.replace(IMAGE_MARKDOWN_PATTERN, (whole, _alt, id) => {
    if (!ghostSet.has(id)) return whole;
    // Replace with an explicit error block so the user understands
    // why the image isn't rendering. Keeps the prompt context if it
    // followed in a "Prompt:" footer (we strip that too in the
    // post-process below to avoid orphan footers).
    return `> ⚠️ Image generation failed — try \`/img <description>\` to retry. (Internal: ID \`${id}\` not found.)`;
  });

  // The model often follows the bogus `![](...)` with a "Prompt: ..."
  // and "Model: nano-banana-2 · 512x512" footer. Now that the image
  // is gone, the footer is misleading orphaned telemetry. Strip it.
  const cleanedNoFooter = cleaned
    .replace(/\n+\*\*Prompt:\*\*[^\n]*\n+\*\*Model:\*\*[^\n]*/gi, "")
    .replace(/\n+\*\*Model:\*\*[^\n]*/gi, "");

  return {
    cleaned: cleanedNoFooter,
    found: ids.size,
    valid: validIds.size,
    ghosts: ghostIds.length,
    ghostIds,
  };
}
