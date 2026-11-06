import { apiHandler } from "@/lib/utils/http";
import {
  enqueueHarnessAction,
  enqueueSchema,
  readCappedJson,
  readHarnessAction,
  requireHarnessControl,
} from "@/lib/services/harness-control";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/devices/harness/actions: queue one allowlisted action for one PC (HARNESS_CONTROL_KEY only).
 * GET  /api/devices/harness/actions?id=<id>: read that action's state and result.
 * The snapshot door (../route.ts) stays read-only; this door is separate and so is its key.
 * Callers: scripts/agent-os/harness-run.mjs. Nick calls the service directly, in process.
 */
export const POST = apiHandler(
  async (req) => {
    requireHarnessControl(req);
    const parsed = enqueueSchema.safeParse(await readCappedJson(req));
    if (!parsed.success) throw new ServiceError("Invalid harness action request", 400);
    const { from, ...input } = parsed.data;
    return enqueueHarnessAction({ ...input, requestedBy: from ? `cli:${from}` : "cli" });
  },
  { auth: "none", rateLimit: "sync" },
);

export const GET = apiHandler(
  async (req) => {
    requireHarnessControl(req);
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new ServiceError("An action id is required", 400);
    const action = await readHarnessAction(id);
    if (!action) throw new ServiceError("No such action", 404);
    return { action };
  },
  { auth: "none", rateLimit: "sync" },
);
