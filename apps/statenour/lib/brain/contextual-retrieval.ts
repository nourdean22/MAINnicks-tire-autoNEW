/**
 * Contextual Retrieval · Anthropic technique (anthropic.com/news/contextual-retrieval)
 *
 * Prepends a one-line, LLM-generated context header (~50-100 tokens) to a
 * chunk BEFORE it is embedded, so the chunk's vector captures *where it sits
 * in the whole document* (what doc / when / who / how it relates). Anthropic
 * reports this cuts retrieval failures 35-49%.
 *
 * Gating + safety:
 *   · Caller gates on the NICK_CONTEXTUAL_RETRIEVAL feature flag. This module
 *     ALSO self-checks the flag so it's safe to call unconditionally.
 *   · ANY failure (flag off, empty header, model error, timeout, abort) returns
 *     the chunk UNCHANGED. It never throws into the ingestion loop.
 *   · Uses the cheap "fast" model lane (getModel("fast") + generateText), the
 *     same one image-prompt-synth uses for low-stakes one-liners.
 *
 * Owner of the flag spec: lib/feature-flags.ts (NICK_CONTEXTUAL_RETRIEVAL).
 */

import { langfuseTelemetry } from "@/lib/observability/langfuse";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/provider";
import { getFlag } from "@/lib/feature-flags";

const CONTEXT_SYSTEM = [
  "You write a single short context line for a document chunk so it can be",
  "retrieved on its own. Say what document the chunk is from and how the chunk",
  "fits the whole (who/when/what topic). One sentence, 50-100 tokens, no",
  "preamble, no quotes, no markdown. Do NOT restate the chunk verbatim.",
].join(" ");

/** Hard cap on the doc excerpt we feed the model — keeps the call cheap. */
const MAX_DOC_EXCERPT_CHARS = 1800;
/** Abort the synth after this — ingest latency must stay bounded. */
const SYNTH_TIMEOUT_MS = 8000;

/**
 * Return `chunk` with a one-line context header prepended, or the original
 * `chunk` unchanged on flag-off or any failure.
 */
export async function contextualizeChunk(
  chunk: string,
  docContext: { title?: string; source?: string; fullDocExcerpt?: string },
  opts?: { signal?: AbortSignal },
): Promise<string> {
  // Self-gate · belt-and-suspenders alongside the caller's flag check.
  if (!getFlag("NICK_CONTEXTUAL_RETRIEVAL")?.isOn) return chunk;

  const trimmed = chunk?.trim();
  if (!trimmed) return chunk;

  try {
    const excerpt = (docContext.fullDocExcerpt || "").slice(0, MAX_DOC_EXCERPT_CHARS);
    const prompt = [
      docContext.title ? `DOCUMENT TITLE: ${docContext.title}` : "",
      docContext.source ? `SOURCE: ${docContext.source}` : "",
      excerpt ? `DOCUMENT EXCERPT (start of doc):\n${excerpt}` : "",
      "",
      "CHUNK TO SITUATE:",
      trimmed.slice(0, 1200),
      "",
      "Context line:",
    ]
      .filter(Boolean)
      .join("\n");

    // Caller-supplied signal wins; otherwise cap the synth ourselves so a
    // slow provider can't stall the ingest loop.
    const signal = opts?.signal ?? AbortSignal.timeout(SYNTH_TIMEOUT_MS);

    const { text } = await generateText({
      model: getModel("fast"),
      experimental_telemetry: langfuseTelemetry({ functionId: "contextual-retrieval" }),
      system: CONTEXT_SYSTEM,
      prompt,
      maxOutputTokens: 160,
      temperature: 0.3,
      abortSignal: signal,
    });

    const header = text
      .trim()
      .replace(/^["'`]|["'`]$/g, "")
      .replace(/^context\s*line\s*:\s*/i, "")
      .trim();

    // Too short to be a useful header → embed the chunk as-is.
    if (header.length < 12) return chunk;

    return `${header}\n\n${trimmed}`;
  } catch {
    // Graceful degrade · never break ingestion.
    return chunk;
  }
}
