import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  buildKnowledgeCandidate,
  type KnowledgeCandidate,
  type KnowledgeEvidence,
  type KnowledgeKind,
  type KnowledgeRiskLevel,
} from "@/lib/knowledge/candidate";

export interface NotebookLmExtractedItem {
  text: string;
  category: string;
  citation?: string;
  sourceFile: string;
}

export interface NotebookLmCandidateInput extends NotebookLmExtractedItem {
  slug: string;
  domain: string;
  verificationScore: number;
  bestMatchChunk?: string;
  operatorConfirmedAction?: boolean;
}

export function parseNotebookLmMarkdown(
  content: string,
  sourceFile: string,
  defaultCategory = BRAIN_CATEGORIES.RESEARCH_CLAIM,
): NotebookLmExtractedItem[] {
  const items: NotebookLmExtractedItem[] = [];
  let currentCategory = defaultCategory;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("#")) {
      const header = trimmed.toLowerCase();
      if (header.includes("contradict") || header.includes("counter") || header.includes("debate")) {
        currentCategory = BRAIN_CATEGORIES.RESEARCH_CONTRADICTION;
      } else if (header.includes("action") || header.includes("plan") || header.includes("task") || header.includes("todo")) {
        currentCategory = BRAIN_CATEGORIES.RESEARCH_ACTION;
      } else if (header.includes("question")) {
        currentCategory = BRAIN_CATEGORIES.RESEARCH_QUESTION;
      } else if (header.includes("claim") || header.includes("finding")) {
        currentCategory = BRAIN_CATEGORIES.RESEARCH_CLAIM;
      }
      continue;
    }

    const match = trimmed.match(/^(?:-\s*\[\s*\]|-\s*|\*\s*|\d+\.\s*)(.+)$/);
    if (!match) continue;

    let text = match[1].trim();
    if (!text) continue;
    let citation: string | undefined;
    const citationMatch = text.match(/[\(\[]\s*sources?:?\s*([^\)\]]+)[\)\]]\s*$/i);
    if (citationMatch) {
      citation = citationMatch[1].trim();
      text = text.slice(0, text.length - citationMatch[0].length).trim();
    }
    if (text.length < 1) continue;
    items.push({ text, category: currentCategory, citation, sourceFile });
  }

  return items;
}

export function notebookLmCategoryToKind(category: string): KnowledgeKind {
  if (category === BRAIN_CATEGORIES.RESEARCH_ACTION) return "action";
  if (category === BRAIN_CATEGORIES.RESEARCH_CONTRADICTION) return "contradiction";
  if (category === BRAIN_CATEGORIES.RESEARCH_QUESTION) return "question";
  return "fact";
}

export function notebookLmRisk(domain: string): KnowledgeRiskLevel {
  return ["health", "finance", "legal"].includes(domain.toLowerCase()) ? "high" : "low";
}

export function buildNotebookLmCandidate(input: NotebookLmCandidateInput): KnowledgeCandidate {
  const evidence: KnowledgeEvidence[] = [];
  if (input.citation) {
    evidence.push({ type: "citation", value: input.citation });
  }
  evidence.push({ type: "source_document", value: input.sourceFile });
  if (input.bestMatchChunk && input.verificationScore > 0) {
    evidence.push({
      type: "semantic_match",
      value: input.bestMatchChunk.slice(0, 2_000),
      score: Math.max(0, Math.min(1, input.verificationScore)),
    });
  }
  if (input.operatorConfirmedAction) {
    evidence.push({ type: "operator_confirmation", value: "CLI --create-tasks" });
  }

  return buildKnowledgeCandidate({
    content: input.text,
    kind: notebookLmCategoryToKind(input.category),
    sourceType: "notebooklm",
    sourceId: `${input.slug}:${input.sourceFile}:${input.text.slice(0, 80)}`,
    sourceUri: input.sourceFile,
    generatedBy: "notebooklm",
    confidence: Math.max(0, Math.min(1, input.verificationScore)),
    riskLevel: notebookLmRisk(input.domain),
    evidence,
    metadata: {
      slug: input.slug,
      domain: input.domain,
      sourceCategory: input.category,
      grounded: input.verificationScore >= 0.8,
    },
  });
}
