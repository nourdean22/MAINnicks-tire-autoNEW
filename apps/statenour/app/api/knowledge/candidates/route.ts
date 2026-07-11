import { z } from "zod";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  BuildKnowledgeCandidateInput,
  KnowledgeCandidateSchema,
  buildKnowledgeCandidate,
} from "@/lib/knowledge/candidate";
import {
  listPendingKnowledgeCandidates,
  persistKnowledgeCandidate,
  reviewKnowledgeCandidate,
} from "@/lib/knowledge/candidate-store";

const createSchema = z.object({
  action: z