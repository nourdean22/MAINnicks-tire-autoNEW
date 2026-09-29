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
import { classifyTrustTier, type TrustTier } from "@/lib/brain/memory-trust";

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
  effectiveFrom?: Date;
  effectiveUntil?: Date;
  /** Optional explicit origin tier when provenance cannot be derived from source/category alone. */
  trustTier?: TrustTier;
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
  effectiveFrom?: string;
  effectiveUntil?: string;
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
  if (input.effectiveFrom) env.effectiveFrom = input.effectiveFrom.toISOString();
  if (input.effectiveUntil) env.effectiveUntil = input.effectiveUntil.toISOString();
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
  /** Preserve a writer's existing confidence semantics while moving it behind admission. */
  confidence?: number;
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
  const normalized = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

  // Outcome awareness matters. remember() intentionally returns the existing
  // row for a rejected weaker-evidence contradiction and for no-op repeats.
  // Without this pre-image, admission would mutate the winning row's
  // trust/effective metadata even though the candidate never became canonical.
  const before = await prisma.brainMemory.findUnique({
    where: { category_key: { category: input.category, key: input.key } },
    select: { id: true, content: true, source: true, metadata: true },
  });

  const row = await brainMemory.remember(input.category, input.key, input.content, input.source, {
    ...(input.metadata ?? {}),
    admission: envelope,
  });

  const candidatePersisted = normalized(row.content) === normalized(input.content);
  const contentChanged =
    !before || normalized(before.content) !== normalized(input.content);
  const acceptedCanonicalWrite = candidatePersisted && contentChanged;

  // Q-31: only a candidate that actually became canonical is allowed to stamp
  // provenance, validity, source, or writer-supplied confidence. A parked
  // weaker contradiction and a same-content no-op leave the winning row alone.
  if (acceptedCanonicalWrite) {
    const trustTier: TrustTier =
      input.trustTier ??
      (input.memoryKind === "derived" || input.extractionMethod === "llm_extract"
        ? "AGENT_INFERRED"
        : classifyTrustTier(input.source, undefined, input.category));

    const rowMetadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};

    const patch: Record<string, unknown> = {
      source: input.source,
      trustTier,
      metadata: {
        ...rowMetadata,
        ...(input.metadata ?? {}),
        admission: envelope,
      },
    };
    if (input.effectiveFrom) patch.validFrom = input.effectiveFrom;
    if (input.effectiveUntil) patch.validUntil = input.effectiveUntil;
    if (typeof input.confidence === "number") {
      patch.confidence = Math.max(0, Math.min(1, input.confidence));
    }

    await prisma.brainMemory.update({
      where: { id: row.id },
      data: patch as never,
    });

    // Shadow only: measurable contradiction candidates, no live ticker/page.
    // Keep it off the write latency path and never let detector failure reject
    // an otherwise valid memory admission.
    if (input.memoryKind !== "episodic") {
      void import("@/lib/brain/memory-contradiction-shadow")
        .then(({ shadowAdmissionContradictions }) =>
          shadowAdmissionContradictions({
            memoryId: row.id,
            category: input.category,
            content: input.content,
          }),
        )
        .catch(() => undefined);
    }
  }

  return { id: row.id, evidenceClass: envelope.evidenceClass, memoryKind: envelope.memoryKind };
}

