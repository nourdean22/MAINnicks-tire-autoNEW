/**
 * GET /api/system/integrations — Returns full integration registry with status.
 * POST /api/system/integrations — Update a tool's status (for manual overrides).
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. No external fetch
 * consumers · returning unwrapped data lets the envelope wrap cleanly.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { readRequestJson } from "@/lib/utils/http";
import { getRegistry, getRegistryStats, getTool } from "@/lib/integrations/registry";

export const GET = apiHandler(
  async () => {
    // v10.0.183 · auth was on POST but missing on GET. The integration
    // registry exposes which tools are configured + which env vars
    // are set — leaking that helps attackers probe the surface area.
    const registry = getRegistry();
    const stats = getRegistryStats();
    return { stats, tools: registry };
  },
  { auth: "owner" },
);

export const POST = apiHandler(
  async (req) => {
    const body = await readRequestJson<{ toolId: string; action: string }>(req);
    const { toolId, action } = body;

    if (!toolId || !action) {
      throw new ServiceError("toolId and action required", 400);
    }

    const tool = getTool(toolId);
    if (!tool) {
      throw new ServiceError(`Tool '${toolId}' not found`, 404);
    }

    // For now, return tool info + action acknowledgment.
    // Future: persist status overrides in DB.
    return {
      tool: tool.id,
      name: tool.name,
      action,
      message: `Action '${action}' acknowledged for ${tool.name}. Status resolved from env: ${tool.status}`,
    };
  },
  { auth: "owner" },
);
