import { z } from "zod";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { notebookLMProvider } from "@/lib/intelligence/search/notebooklm-mcp";

const notebookLMSchema = z.object({
  action: z.string().min(1, "Action is required"),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const POST = apiHandler(
  async (req) => {
    const payload = await readRequestJson(req);
    const { action, params } = notebookLMSchema.parse(payload);
    
    return notebookLMProvider.call(action, params);
  },
  { auth: "owner" }
);

export const GET = apiHandler(
  async () => {
    return notebookLMProvider.health();
  },
  { auth: "owner" }
);
