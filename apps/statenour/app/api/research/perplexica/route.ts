import { z } from "zod";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { askPerplexica } from "@/lib/integrations/perplexica";

const searchSchema = z.object({
  query: z.string().min(1, "Query is required"),
  options: z
    .object({ optimizationMode: z.enum(["speed", "balanced", "quality"]).optional() })
    .optional(),
});

// Direct to the Perplexica v1.12 HTTP API (no MCP wrapper). See
// lib/integrations/perplexica.ts.
export const POST = apiHandler(
  async (req) => {
    const payload = await readRequestJson(req);
    const { query, options } = searchSchema.parse(payload);

    return askPerplexica(query, options ?? {});
  },
  { auth: "owner" }
);
