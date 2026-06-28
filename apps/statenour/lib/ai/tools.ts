/**
 * AI Agent Tools — re-export barrel.
 *
 * AUTHORITATIVE INDEX: lib/ai/tools/catalog.ts (TOOL_CATALOG · 143 tools).
 * The contract test in tests/ai/tool-catalog.test.ts asserts 1:1 alignment
 * between nourTools (this file's only export) and TOOL_CATALOG, so the
 * catalog is the source of truth.
 *
 * v10.0.529.106 · Wave 82 · the previous 5,537-LOC monolith was split
 * into 7 domain files (brain · tasks · business · content · social ·
 * system · meta) under lib/ai/tools/. This file now does nothing but
 * compose them into the canonical nourTools object so all 150+ callers
 * (chat route · tool-families · tool-embeddings · stats route · etc.)
 * continue to work unchanged. Adding a new tool: pick the right domain
 * file, then add a catalog entry — no edits needed here.
 *
 * Used with AI SDK tool calling in the chat and command endpoints.
 */

import { brainTools } from "@/lib/ai/tools/brain";
import { tasksTools } from "@/lib/ai/tools/tasks";
import { businessTools } from "@/lib/ai/tools/business";
import { contentTools } from "@/lib/ai/tools/content";
import { socialTools } from "@/lib/ai/tools/social";
import { systemTools } from "@/lib/ai/tools/system";
import { metaTools } from "@/lib/ai/tools/meta";

export const rawTools = {
  ...brainTools,
  ...tasksTools,
  ...businessTools,
  ...contentTools,
  ...socialTools,
  ...systemTools,
  ...metaTools,
};

function wrapToolsWithEmptyHandling<T extends Record<string, any>>(tools: T): T {
  const wrapped: Record<string, any> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!tool.execute) {
      wrapped[name] = tool;
      continue;
    }
    const originalExecute = tool.execute;
    wrapped[name] = {
      ...tool,
      execute: async (args: any) => {
        const res = await originalExecute(args);
        
        const isQueryName = /^(get|find|list|search|locate|read|query|fetch)/i.test(name);
        const isEmptyArray = Array.isArray(res) && res.length === 0;
        const isEmptyDataObject =
          res &&
          typeof res === "object" &&
          "data" in res &&
          Array.isArray(res.data) &&
          res.data.length === 0;
        const isNullOrUndefined = res === null || res === undefined;

        if (isQueryName && (isNullOrUndefined || isEmptyArray || isEmptyDataObject)) {
          return {
            success: true,
            count: 0,
            data: [],
            status: "no_data_found",
            message: "Query completed successfully, but zero matching records were found.",
          };
        }
        return res;
      },
    };
  }
  return wrapped as T;
}

export const nourTools = wrapToolsWithEmptyHandling(rawTools);
