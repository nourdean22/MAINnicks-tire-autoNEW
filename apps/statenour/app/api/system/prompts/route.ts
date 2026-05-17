/**
 * GET /api/system/prompts · v10.0.165
 *
 * Returns the prompt registry from lib/prompts/library.ts plus stats.
 * Drives /system/prompts. Owner-gated. Read-only — editing is a
 * future slice (per JIT, ship listing first).
 *
 * Optional filters:
 *   ?category=role|task|verifier|ground|...
 *   ?tag=fabrication|production|chat|...
 */

import { apiHandler } from "@/lib/utils/http";
import {
  listPrompts,
  getRegistryStats,
  type PromptCategory,
} from "@/lib/prompts/library";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const category = url.searchParams.get("category") as PromptCategory | null;
    const tag = url.searchParams.get("tag");

    const prompts = listPrompts({
      category: category ?? undefined,
      tag: tag ?? undefined,
    });

    return {
      stats: getRegistryStats(),
      filter: {
        category: category ?? null,
        tag: tag ?? null,
      },
      prompts,
    };
  },
  { auth: "owner" },
);
