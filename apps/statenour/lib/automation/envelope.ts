/**
 * Explainability envelope · v10.0.149 · May 03 · Slice #2 of post-audit
 * consolidation.
 *
 * Per the audit recommendation: every Nick response and every
 * autonomous action should carry an envelope answering "why did the
 * system do that, was it right, what rule allowed it, what evidence?"
 *
 * Per Kaizen (extend, don't duplicate): we don't add a new table.
 * AgentTrace already has `traceId` + `metadata` Json. This module
 * **standardizes the metadata shape** so every operator-visible turn
 * carries the same envelope keys, and exposes typed helpers for
 * writing + reading them.
 *
 * Per JIT: only the fields proven necessary by the audit are encoded
 * in the type. Future fields (e.g. self-critique pass output, debate
 * transcripts) get added when the use case appears, not before.
 *
 * Schema (lives in AgentTrace.metadata):
 *   envelope: {
 *     version: 1,
 *     policyId: string | null,    // links to AutomationPolicy.id
 *     memoriesUsed: Array<{       // BrainMemory rows retrieved + injected
 *       id: string,
 *       category: string,
 *       confidence: number | null,
 *       preview: string,          // first 80 chars
 *     }>,
 *     factsAssumed: string[],     // operator-readable assertions the
 *                                 // chain relied on (e.g. "Nour is in
 *                                 // Cleveland", "Today is Tuesday").
 *     toolsCalled: Array<{        // structured tool-call log
 *       name: string,             // tool id from lib/ai/tools.ts
 *       ok: boolean,
 *       durationMs: number,
 *     }>,
 *     reason: string | null,      // 1-line explanation in operator
 *                                 // language (NOT the chain-of-thought)
 *   }
 */

import { recordTrace, type TraceSource } from "@/lib/ai/agent-trace";

export const ENVELOPE_VERSION = 1 as const;

export interface EnvelopeMemory {
  id: string;
  category: string;
  confidence: number | null;
  preview: string;
}

export interface EnvelopeToolCall {
  name: string;
  ok: boolean;
  durationMs: number;
}

export interface ExplanationEnvelope {
  version: typeof ENVELOPE_VERSION;
  policyId: string | null;
  memoriesUsed: EnvelopeMemory[];
  factsAssumed: string[];
  toolsCalled: EnvelopeToolCall[];
  reason: string | null;
}

/**
 * Build an envelope object. All fields default to safe empties so a
 * caller can build incrementally — start with `policyId`, fill memories
 * after retrieval, fill tools as they execute, set reason at the end.
 */
export function buildEnvelope(
  partial: Partial<ExplanationEnvelope> = {},
): ExplanationEnvelope {
  return {
    version: ENVELOPE_VERSION,
    policyId: partial.policyId ?? null,
    memoriesUsed: partial.memoriesUsed ?? [],
    factsAssumed: partial.factsAssumed ?? [],
    toolsCalled: partial.toolsCalled ?? [],
    reason: partial.reason ?? null,
  };
}

/**
 * Read an envelope back out of an AgentTrace.metadata blob. Returns
 * null if the trace pre-dates the envelope contract or stored an
 * incompatible shape — older rows aren't retroactively backfilled.
 */
export function extractEnvelope(
  metadata: unknown,
): ExplanationEnvelope | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as { envelope?: unknown };
  if (!m.envelope || typeof m.envelope !== "object") return null;
  const env = m.envelope as Partial<ExplanationEnvelope>;
  if (env.version !== ENVELOPE_VERSION) return null;
  // Coerce to a complete shape so consumers don't have to re-default
  // every field.
  return {
    version: ENVELOPE_VERSION,
    policyId: env.policyId ?? null,
    memoriesUsed: Array.isArray(env.memoriesUsed) ? env.memoriesUsed : [],
    factsAssumed: Array.isArray(env.factsAssumed) ? env.factsAssumed : [],
    toolsCalled: Array.isArray(env.toolsCalled) ? env.toolsCalled : [],
    reason: env.reason ?? null,
  };
}

/**
 * Convenience writer: persist a trace row with the envelope embedded
 * in metadata. Fire-and-forget like recordTrace — never throws.
 *
 * Use this at the END of a chain step when you have the full envelope
 * assembled. For incremental capture during the chain, use the
 * EnvelopeBuilder class below.
 */
export async function recordTraceWithEnvelope(
  start: {
    traceId: string;
    parentId?: string | null;
    source: TraceSource;
    label: string;
    provider?: string | null;
    model?: string | null;
    inputChars?: number;
  },
  finish: {
    durationMs: number;
    outputChars?: number;
    costCents?: number;
    errorClass?: string | null;
    errorMessage?: string | null;
  },
  envelope: ExplanationEnvelope,
): Promise<void> {
  await recordTrace(start, {
    ...finish,
    toolCalls: envelope.toolsCalled.length,
    metadataDelta: { envelope },
  });
}

/**
 * Streaming-friendly builder. Lets the chain accumulate envelope data
 * as it runs without rebuilding the immutable object each time.
 *
 *   const eb = new EnvelopeBuilder("tool.send-email-via-resend");
 *   const memories = await retrieveMemories();
 *   eb.addMemories(memories);
 *   const r = await callTool("send-email", { ... });
 *   eb.recordToolCall("send-email", r.ok, r.durationMs);
 *   eb.setReason("Replying to overdue lead per auto_followup rule");
 *   await recordTraceWithEnvelope(start, finish, eb.build());
 */
export class EnvelopeBuilder {
  private memoriesUsed: EnvelopeMemory[] = [];
  private factsAssumed: string[] = [];
  private toolsCalled: EnvelopeToolCall[] = [];
  private reason: string | null = null;

  constructor(private policyId: string | null = null) {}

  setPolicyId(id: string | null): this {
    this.policyId = id;
    return this;
  }

  addMemory(m: EnvelopeMemory): this {
    this.memoriesUsed.push(m);
    return this;
  }

  /** Bulk-add — convenience for "we just retrieved 5 memories at once". */
  addMemories(ms: EnvelopeMemory[]): this {
    this.memoriesUsed.push(...ms);
    return this;
  }

  addFact(fact: string): this {
    if (fact.trim()) this.factsAssumed.push(fact.trim());
    return this;
  }

  recordToolCall(name: string, ok: boolean, durationMs: number): this {
    this.toolsCalled.push({ name, ok, durationMs });
    return this;
  }

  setReason(reason: string | null): this {
    this.reason = reason ? reason.slice(0, 240) : null;
    return this;
  }

  build(): ExplanationEnvelope {
    return buildEnvelope({
      policyId: this.policyId,
      memoriesUsed: [...this.memoriesUsed],
      factsAssumed: [...this.factsAssumed],
      toolsCalled: [...this.toolsCalled],
      reason: this.reason,
    });
  }
}

/**
 * Truncate a memory preview to the envelope's standard 80 chars. Used
 * by callers that materialize a BrainMemory row into envelope shape.
 */
export function makeMemoryPreview(content: string): string {
  if (content.length <= 80) return content;
  return content.slice(0, 80).trimEnd() + "…";
}
