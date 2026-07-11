import {
  buildKnowledgeCandidate,
  type KnowledgeCandidate,
  type KnowledgeKind,
} from "@/lib/knowledge/candidate";

export interface ParsedObsidianNote {
  metadata: Record<string, unknown>;
  content: string;
}

export interface ObsidianCandidateInput {
  content: string;
  title: string;
  category: string;
  sourceId: string;
  sourceUri: string;
  metadata: Record<string, unknown>;
  categoryWasExplicit: boolean;
  sourceName: string;
  modifiedAt: Date;
}

export function parseObsidianFrontmatter(fileContent: string): ParsedObsidianNote {
  const normalized = fileContent.trim();
  if (!normalized.startsWith("---")) return { metadata: {}, content: fileContent.trim() };
  const lines = normalized.split(/\r?\n/);
  const closing = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (closing < 0) return { metadata: {}, content: fileContent.trim() };

  const metadata: Record<string, unknown> = {};
  for (const line of lines.slice(1, closing + 1)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 1) continue;
    const key = trimmed.slice(0, colon).trim();
    let raw = trimmed.slice(colon + 1).trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    if (raw === "true") metadata[key] = true;
    else if (raw === "false") metadata[key] = false;
    else if (raw !== "" && Number.isFinite(Number(raw))) metadata[key] = Number(raw);
    else if (key === "tags") metadata[key] = raw.replace(/^\[|\]$/g, "").split(",").map((value) => value.trim()).filter(Boolean);
    else metadata[key] = raw;
  }

  return {
    metadata,
    content: lines.slice(closing + 2).join("\n").trim(),
  };
}

export function obsidianKnowledgeKind(metadata: Record<string, unknown>): KnowledgeKind {
  const type = typeof metadata.type === "string" ? metadata.type.toLowerCase() : "";
  if (["action", "task", "todo"].includes(type)) return "action";
  if (type === "question") return "question";
  if (["rule", "principle", "policy"].includes(type)) return "rule";
  if (type === "fact") return "fact";
  if (type === "inference") return "inference";
  if (type === "contradiction") return "contradiction";
  return "observation";
}

export function buildObsidianCandidate(input: ObsidianCandidateInput): KnowledgeCandidate {
  const explicitOperatorAuthored = input.categoryWasExplicit && input.metadata.generated_by !== "ai";
  const rawConfidence = typeof input.metadata.confidence === "number"
    ? input.metadata.confidence
    : explicitOperatorAuthored ? 0.95 : 0.65;
  const kind = obsidianKnowledgeKind(input.metadata);
  const operatorConfirmedAction = kind === "action" && input.metadata.action_approved === true;

  return buildKnowledgeCandidate({
    content: `[${input.title}]\n${input.content}`,
    kind,
    sourceType: "obsidian",
    sourceId: input.sourceId,
    sourceUri: input.sourceUri,
    observedAt: input.modifiedAt,
    generatedBy: explicitOperatorAuthored ? "human:obsidian" : "obsidian:classifier",
    confidence: Math.max(0, Math.min(1, rawConfidence)),
    riskLevel: input.metadata.risk_level === "high" ? "high" : input.metadata.risk_level === "medium" ? "medium" : "low",
    evidence: [
      explicitOperatorAuthored
        ? { type: "operator_authored", value: input.sourceUri }
        : { type: "source_document", value: input.sourceUri },
      ...(operatorConfirmedAction
        ? [{ type: "operator_confirmation" as const, value: "frontmatter action_approved: true" }]
        : []),
    ],
    metadata: {
      ...input.metadata,
      sourceName: input.sourceName,
      categoryWasExplicit: input.categoryWasExplicit,
      targetCategory: input.category,
    },
  });
}
