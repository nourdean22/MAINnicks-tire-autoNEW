/**
 * lib/brain/evidence-pack.ts · 2026-09-08 (Brain plan, Wave 2 — the retrieval arbiter's I/O)
 *
 * Turns the two recall lanes' outputs into arbiter candidates and renders the
 * arbitrated pack as ONE fenced prompt block. Behind NICK_RECALL_ARBITER; when
 * the flag is off brain-context renders the two lanes separately as before.
 *
 * Pure except for the fence helper (string in, string out).
 */
import { arbitrate, type ArbiterCandidate, type EvidenceItem, type ArbiterOptions } from "@/lib/brain/retrieval-arbiter";
import { evidenceClassForSource } from "@/lib/brain/memory-commit-gateway";
import { fenceContent } from "@/lib/ai/tool-result-fencing";

export interface HybridHitLike {
  memoryId?: string;
  id?: string;
  key?: string;
  category?: string;
  source?: string;
  content?: string;
  confidence?: number;
  seenCount?: number;
}

export interface RankedRowLike {
  id: string;
  key?: string;
  category?: string;
  source?: string;
  content?: string;
  seenCount?: number;
  confidence?: number;
}

export function candidatesFromLanes(hybridHits: readonly HybridHitLike[], contextualRows: readonly RankedRowLike[]): ArbiterCandidate[] {
  const out: ArbiterCandidate[] = [];
  hybridHits.forEach((h, rank) => {
    const id = String(h.memoryId ?? h.id ?? "");
    if (!id) return;
    out.push({ id, key: h.key, category: h.category, source: h.source, content: h.content, lane: "hybrid", rank });
  });
  contextualRows.forEach((r, rank) => {
    if (!r.id) return;
    out.push({ id: String(r.id), key: r.key, category: r.category, source: r.source, content: r.content, lane: "contextual", rank });
  });
  return out;
}

const LABEL: Record<string, string> = {
  operator_stated: "you stated",
  system_receipt: "receipt",
  direct_observation: "observed",
  external_source: "external",
  supported_inference: "inferred",
  generated_summary: "summary",
  prediction: "prediction",
  weak_inference: "unclassified",
};

/** One line per item: lanes · evidence label · category · content (truncated by the lanes already). */
export function renderEvidencePack(items: readonly EvidenceItem[], opts?: { maxChars?: number }): string {
  if (items.length === 0) return "";
  const maxChars = opts?.maxChars ?? 2400;
  const lines: string[] = [`## Nick Brain — Evidence pack (${items.length}, one list across both recall lanes)`];
  let used = lines[0].length;
  for (const it of items) {
    const label = LABEL[evidenceClassForSource(it.source ?? "")] ?? "unclassified";
    const lanes = it.lanes.length === 2 ? "both lanes" : it.lanes[0] === "hybrid" ? "hybrid" : "contextual";
    const line = `- [${label} · ${it.category ?? "memory"} · ${lanes}] ${(it.content ?? "").replace(/\s+/g, " ").trim().slice(0, 220)}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return fenceContent("recallEvidencePack", "memory_recall", lines.join("\n"));
}

export interface EvidencePackResult {
  items: EvidenceItem[];
  block: string;
  candidates: number;
}

export function buildEvidencePack(
  hybridHits: readonly HybridHitLike[],
  contextualRows: readonly RankedRowLike[],
  opts?: ArbiterOptions & { maxChars?: number },
): EvidencePackResult {
  const candidates = candidatesFromLanes(hybridHits, contextualRows);
  const items = arbitrate(candidates, opts);
  return { items, block: renderEvidencePack(items, { maxChars: opts?.maxChars }), candidates: candidates.length };
}
