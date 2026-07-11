import { z } from "zod";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  notebookLMProvider,
  type NotebookAlias,
} from "@/lib/intelligence/search/notebooklm-mcp";

const notebookAliases = [
  "statenour-intel",
  "competitor-research",
  "financial-models",
] as const satisfies readonly NotebookAlias[];

const notebookLMSchema = z.object({
  action: z.string().trim().min(1, "Action is required").max(100),
  params: z.record(z.string(), z.unknown()).optional(),
  notebookAlias: z.enum(notebookAliases).optional(),
});

export const POST = apiHandler(
  async (req) => {
    const payload = await readRequestJson(req);
    const { action, params, notebookAlias } = notebookLMSchema.parse(payload);

    return notebookLMProvider.call(action, params, notebookAlias);
  },
  { auth: "owner", rateLimit: "ai" },
);

export const GET = apiHandler(
  async () => notebookLMProvider.health(),
  { auth: "owner", rateLimit: "general" },
);
