/**
 * lib/brain/memory-admission.ts · 2026-09-08 (Brain plan, Wave 1: the memory truth spine)
 *
 * The commit gateway (memory-commit-gateway.ts) decides HOW a re-sighting is
 * committed; it never said WHAT a memory is. This module is the envelope every
 * semantic write should carry, stamped into BrainMemory.metadata.admission:
 *
 *   memoryKind        episodic (it happened, with an effective time) ·
 *                     semantic (an asserted fact / preference / state) ·
 *                     procedural (a reviewed method) ·
 *                     derived (a model-made synthesis — never independent evidence)
 *   evidenceClass     the gateway ladder, computed from the normalised source
 *   derivedFrom       memory ids a derived row was built from (stale-propagation later)
 *   evidenceRefs      receipts / external ids that support the claim
 *   extractionMethod  who produced the text (explicit_save · operator_pin · llm_extract · cron · import)
 *   modelId           when a model wrote it
 *   contentHash       sha-256 of the trimmed content, for replay-safe identity
 *   admittedAt        ISO timestamp
 *
 * `stampAdmission` is pure and is what the two explicit operator writers use
 * today (lib/services/brain/save.ts, lib/services/pins.ts) — their identity-first
 * mechanics stay, their rows now say what they are. `admitMemory` is the path
 * for NEW writers: it routes through brainMemory.remember() (gateway enforced)
 * and sets the validity interval the as-of recall reads.
 */
import { createHash } from "node:crypto";
import { brainMemory } from "@/lib/brain/memory-manager";
import { prisma } from "@/lib/prisma";
import { evidenceClassForSource, type MemoryEvidenceClass } from "@/lib/brain/memory-commit-gateway";

export type MemoryKind = "episodic" | "semantic" | "procedural" | "derived";
export type ExtractionMethod = "explicit_save" | "operator_pin" | "llm_extract" | "cron" | "import" | "receipt" | "unknown";

export interface AdmissionInput {
  source: string;
  memoryKind: MemoryKind;
  extractionMethod?: ExtractionMethod;
  derivedFrom?: string[];
  evidenceRefs?: string[];
  modelId?: string;
  content?: string;
  now?: Date;
}

export interface AdmissionEnvelope {
  memoryKind: MemoryKind;
  evidenceClass: MemoryEvidenceClass;
  extractionMethod: ExtractionMethod;
  derivedFrom: string[];
  evidenceRefs: string[];
  modelId?: string;
  contentHash?: string;
  admittedAt: string;
  /** A derived memory with no lineage cannot be invalidated when its source changes. */
  orphanDerived?: true;
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");
}

export function buildAdmissionEnvelope(input: AdmissionInput): AdmissionEnvelope {
  const derivedFrom = [...new Set(input.derivedFrom ?? [])];
  const env: AdmissionEnvelope = {
    memoryKind: input.memoryKind,
    evidenceClass: evidenceClassForSource(input.source),
    extractionMethod: input.extractionMethod ?? "unknown",
    derivedFrom,
    evidenceRefs: [...new Set(input.evidenceRefs ?? [])],
    admittedAt: (input.now ?? new Date()).toISOString(),
  };
  if (input.modelId) env.modelId = input.modelId;
  if (input.content) env.contentHash = contentHash(input.content);
  if (input.memoryKind === "derived" && derivedFrom.length === 0) env.orphanDerived = true;
  // A model-made synthesis is never stronger than an inference, whatever its source string says.
  if (input.memoryKind === "derived" && (env.evidenceClass === "operator_stated" || env.evidenceClass === "system_receipt" || env.evidenceClass === "direct_observation")) {
    env.evidenceClass = "generated_summary";
  }
  return env;
}

/** Pure: returns a metadata object carrying `admission`. Existing keys are kept. */
export function stampAdmission(
  metadata: Record<string, unknown> | null | undefined,
  input: AdmissionInput,
): Record<string, unknown> {
  return { ...(metadata ?? {}), admission: buildAdmissionEnvelope(input) };
}

export interface AdmitMemoryInput extends AdmissionInput {
  category: string;
  key: string;
  content: string;
  /** Validity interval the as-of recall reads (validityWhere). */
  effectiveFrom?: Date;
  effectiveUntil?: Date;
  metadata?: Record<string, unknown>;
}

export interface AdmitMemoryResult {
  id: string;
  evidenceClass: MemoryEvidenceClass;
  memoryKind: MemoryKind;
}

/**
 * The write path for new semantic writers: gateway-enforced remember() plus the
 * envelope plus the validity interval. A direct BrainMemory create is for telemetry
 * rows and the two identity-first operator writers only — the ratchet test in
 * tests/repo enforces that.
 */
export async function admitMemory(input: AdmitMemoryInput): Promise<AdmitMemoryResult> {
  const envelope = buildAdmissionEnvelope({ ...input, content: input.content });
  const row = await brainMemory.remember(input.category, input.key, input.content, input.source, {
    ...(input.metadata ?? {}),
    admission: envelope,
  });
  if (input.effectiveFrom || input.effectiveUntil) {
    await prisma.brainMemory.update({
      where: { id: row.id },
      data: {
        ...(input.effectiveFrom ? { validFrom: input.effectiveFrom } : {}),
        ...(input.effectiveUntil ? { validUntil: input.effectiveUntil } : {}),
      },
    });
  }
  return { id: row.id, evidenceClass: envelope.evidenceClass, memoryKind: envelope.memoryKind };
}
