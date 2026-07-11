import { z } from "zod";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  KnowledgeCandidateSchema,
  buildKnowledgeCandidate,
} from "@/lib/knowledge/candidate";
import { listAcceptedKnowledgeActions } from "@/lib/knowledge/candidate-actions";
import {
  listPendingKnowledgeCandidates,
  persistKnowledgeCandidate,
  recordKnowledgeCandidateOutcome,
  reviewKnowledgeCandidate,
} from "@/lib/knowledge/candidate-store";

const submitSchema = z.object({
  action: z.literal("submit"),
  candidate: KnowledgeCandidateSchema,
  category: z.string().min(1).optional(),
  key: z.string().min(1).max(512).optional(),
  allowReviewQueue: z.boolean().optional(),
});

const buildAndSubmitSchema = z.object({
  action: z.literal("build_and_submit"),
  input: z.object({
    content: z.string().min(1),
    kind: z.enum(["fact", "observation", "inference", "contradiction", "action", "question", "rule"]),
    sourceType: z.enum(["obsidian", "notebooklm", "graphify", "web", "task_outcome", "manual", "system"]),
    sourceId: z.string().min(1).max(512),
    sourceUri: z.string().min(1).max(2_000).optional(),
    observedAt: z.string().optional(),
    generatedBy: z.string().min(1).max(256),
    confidence: z.number().min(0).max(1),
    riskLevel: z.enum(["low", "medium", "high"]).optional(),
    evidence: z.array(z.object({
      type: z.enum(["citation", "source_document", "semantic_match", "operator_authored", "operator_confirmation", "system_receipt"]),
      value: z.string().min(1).max(2_000),
      score: z.number().min(0).max(1).optional(),
    })).max(20).optional(),
    contradictionRefs: z.array(z.string().min(1).max(512)).max(20).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  category: z.string().min(1).optional(),
  key: z.string().min(1).max(512).optional(),
  allowReviewQueue: z.boolean().optional(),
});

const reviewSchema = z.object({
  action: z.literal("review"),
  memoryId: z.string().min(1),
  decision: z.enum(["accept", "reject"]),
});

const outcomeSchema = z.object({
  action: z.literal("outcome"),
  memoryId: z.string().min(1),
  outcome: z.enum(["confirmed", "disproved", "neutral"]),
  evidence: z.string().max(4_000).optional(),
});

const mutationSchema = z.discriminatedUnion("action", [
  submitSchema,
  buildAndSubmitSchema,
  reviewSchema,
  outcomeSchema,
]);

export const GET = apiHandler(
  async (request) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "20");
    const safeLimit = Number.isFinite(limit) ? limit : 20;
    return url.searchParams.get("view") === "actions"
      ? listAcceptedKnowledgeActions(safeLimit)
      : listPendingKnowledgeCandidates(safeLimit);
  },
  { auth: "owner", rateLimit: "general" },
);

export const POST = apiHandler(
  async (request) => {
    const payload = mutationSchema.parse(await readRequestJson(request));

    if (payload.action === "review") {
      return reviewKnowledgeCandidate(payload.memoryId, payload.decision);
    }
    if (payload.action === "outcome") {
      return recordKnowledgeCandidateOutcome(payload.memoryId, payload.outcome, payload.evidence);
    }

    const candidate = payload.action === "submit"
      ? payload.candidate
      : buildKnowledgeCandidate(payload.input);

    return persistKnowledgeCandidate(candidate, {
      category: payload.category,
      key: payload.key,
      allowReviewQueue: payload.allowReviewQueue,
    });
  },
  { auth: "owner", rateLimit: "sync" },
);
