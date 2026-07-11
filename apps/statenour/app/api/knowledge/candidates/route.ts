import { z } from "zod";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  KnowledgeCandidateSchema,
  buildKnowledgeCandidate,
} from "@/lib/knowledge/candidate";
import {
  listPendingKnowledgeCandidates,
  persistKnowledgeCandidate,
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
    observedAt: z.union([z.string(), z.date()]).optional(),
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

const mutationSchema = z.discriminatedUnion("action", [
  submitSchema,
  buildAndSubmitSchema,
  reviewSchema,
]);

export const GET = apiHandler(
  async (request) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "20");
    return listPendingKnowledgeCandidates(Number.isFinite(limit) ? limit : 20);
  },
  { auth: "owner", rateLimit: "general" },
);

export const POST = apiHandler(
  async (request) => {
    const payload = mutationSchema.parse(await readRequestJson(request));

    if (payload.action === "review") {
      return reviewKnowledgeCandidate(payload.memoryId, payload.decision);
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
