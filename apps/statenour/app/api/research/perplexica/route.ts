import { z } from "zod";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { perplexicaProvider } from "@/lib/intelligence/search/perplexica-mcp";

const searchSchema = z.object({
  query: z.string().min(1, "Query is required"),
  options: z.record(z.string(), z.unknown()).optional(),
});

export const POST = apiHandler(
  async (req) => {
    const payload = await readRequestJson(req);
    const { query, options } = searchSchema.parse(payload);
    
    return perplexicaProvider.search(query, options);
  },
  { auth: "owner" }
);
