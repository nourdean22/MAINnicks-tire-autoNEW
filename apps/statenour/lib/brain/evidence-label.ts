/**
 * Evidence labels · the commit-gateway ladder as operator-facing words ·
 * 2026-09-15 (UI workbench slice 1).
 *
 * Extracted from components/home/brain-node-detail-panel.tsx, where this map
 * lived as a local constant — the only place in the UI that could say
 * "you stated" vs "inferred" about a memory. The inspector, the evidence mark
 * and the graph panel now share ONE vocabulary (the gateway's
 * `MemoryEvidenceClass`; recall renders the same words), so there is no
 * fourth taxonomy.
 *
 * Pure. No React, no Prisma. `import type` only, so it is safe in client
 * bundles.
 */

import type { MemoryEvidenceClass } from "@/lib/brain/memory-commit-gateway";

export interface EvidenceLabel {
  text: string;
  /** Tailwind classes for the chip · gold-on-dark palette, no purple as "AI". */
  cls: string;
}

export const EVIDENCE_LABEL: Record<MemoryEvidenceClass, EvidenceLabel> = {
  operator_stated: { text: "you stated", cls: "border-emerald-500/30 text-emerald-300 bg-emerald-500/10" },
  system_receipt: { text: "receipt", cls: "border-emerald-500/25 text-emerald-300/90 bg-emerald-500/5" },
  direct_observation: { text: "observed", cls: "border-cyan-500/25 text-cyan-300 bg-cyan-500/5" },
  external_source: { text: "external", cls: "border-blue-500/25 text-blue-300 bg-blue-500/5" },
  supported_inference: { text: "inferred", cls: "border-amber-500/25 text-amber-300 bg-amber-500/5" },
  generated_summary: { text: "summary", cls: "border-zinc-500/25 text-zinc-300 bg-zinc-500/5" },
  prediction: { text: "prediction", cls: "border-zinc-500/25 text-zinc-300 bg-zinc-500/5" },
  weak_inference: { text: "weak signal", cls: "border-zinc-600/30 text-zinc-400 bg-zinc-600/10" },
};

const CLASS_SET: ReadonlySet<string> = new Set(Object.keys(EVIDENCE_LABEL));

export function isEvidenceClass(value: unknown): value is MemoryEvidenceClass {
  return typeof value === "string" && CLASS_SET.has(value);
}

/** Label for a class string of unknown provenance; null when it is not a ladder value. */
export function evidenceLabel(value: string | null | undefined): EvidenceLabel | null {
  return isEvidenceClass(value) ? EVIDENCE_LABEL[value] : null;
}

/** BrainMemory.trustTier (schema.prisma) → words. */
export const TRUST_TIER_LABEL: Record<string, string> = {
  OPERATOR: "operator",
  SYSTEM_DERIVED: "system-derived",
  AGENT_INFERRED: "agent-inferred",
  EXTERNAL_CONTENT: "external content",
};

export function trustTierLabel(tier: string | null | undefined): string | null {
  if (!tier) return null;
  return TRUST_TIER_LABEL[tier] ?? tier.toLowerCase().replace(/_/g, " ");
}

export interface ProvenanceInput {
  evidence?: string | null;
  source?: string | null;
  trustTier?: string | null;
  seenCount?: number | null;
  createdAt?: string | Date | null;
  lastVerifiedAt?: string | Date | null;
  validFrom?: string | Date | null;
  validUntil?: string | Date | null;
  supersededById?: string | null;
  /** Reality Ledger `quality` — observed | derived | inferred. */
  quality?: string | null;
  /** Reality Ledger grade H0–H5. */
  grade?: string | null;
}

function daysBetween(from: string | Date, now: Date): number {
  const d = typeof from === "string" ? new Date(from) : from;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

function shortDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The full provenance sentence, one fact per line, in the order the operator
 * needs to trust a claim: what class of evidence · where it came from · how
 * often it was seen · how old · whether it is still believed. Only facts the
 * record actually carries are emitted — an unknown field is silence, not a
 * default.
 */
export function describeProvenance(input: ProvenanceInput, now: Date = new Date()): string[] {
  const lines: string[] = [];
  const label = evidenceLabel(input.evidence);
  if (label) lines.push(label.text);
  if (input.grade) lines.push(`grade ${input.grade}`);
  if (input.quality) lines.push(input.quality);
  if (input.source) lines.push(`source: ${input.source}`);
  const tier = trustTierLabel(input.trustTier);
  if (tier) lines.push(`trust: ${tier}`);
  if (typeof input.seenCount === "number" && input.seenCount > 0) {
    lines.push(input.seenCount === 1 ? "seen once" : `seen ${input.seenCount}×`);
  }
  if (input.createdAt) {
    const days = daysBetween(input.createdAt, now);
    lines.push(days <= 0 ? "recorded today" : `recorded ${days}d ago`);
  }
  if (input.lastVerifiedAt) {
    const days = daysBetween(input.lastVerifiedAt, now);
    lines.push(days <= 0 ? "verified today" : `verified ${days}d ago`);
  }
  if (input.validFrom) lines.push(`believed since ${shortDate(input.validFrom)}`);
  if (input.validUntil) {
    const until = typeof input.validUntil === "string" ? new Date(input.validUntil) : input.validUntil;
    lines.push(until.getTime() <= now.getTime() ? `expired ${shortDate(until)}` : `valid until ${shortDate(until)}`);
  }
  if (input.supersededById) lines.push("superseded by a newer memory");
  return lines;
}
