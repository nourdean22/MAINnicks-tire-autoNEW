import { apiHandler } from "@/lib/utils/http";
import { claimHarnessAction, claimSchema, readCappedJson, requireHarnessControl } from "@/lib/services/harness-control";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/devices/harness/actions/claim { pc }: the PC's poller takes its oldest live action, or null.
 * The reply is a NAME from the allowlist plus its id; the PC looks up the argv in its own copy of
 * config/agent-os/harness-actions.json. Caller: scripts/agent-os/harness-poll.mjs.
 */
export const POST = apiHandler(
  async (req) => {
    requireHarnessControl(req);
    const parsed = claimSchema.safeParse(await readCappedJson(req));
    if (!parsed.success) throw new ServiceError("Invalid claim", 400);
    return { action: await claimHarnessAction(parsed.data.pc) };
  },
  { auth: "none", rateLimit: "sync" },
);
