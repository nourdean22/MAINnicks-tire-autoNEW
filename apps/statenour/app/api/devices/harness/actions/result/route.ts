import { apiHandler } from "@/lib/utils/http";
import {
  HARNESS_RESULT_BODY_MAX,
  completeHarnessAction,
  readCappedJson,
  requireHarnessControl,
  resultSchema,
} from "@/lib/services/harness-control";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/devices/harness/actions/result: the PC that claimed an action posts its exit code and trimmed
 * output, once. A second post, or a post from another PC, is refused (409). Caller: harness-poll.mjs.
 */
export const POST = apiHandler(
  async (req) => {
    requireHarnessControl(req);
    const parsed = resultSchema.safeParse(await readCappedJson(req, HARNESS_RESULT_BODY_MAX));
    if (!parsed.success) throw new ServiceError("Invalid harness result", 400);
    return completeHarnessAction(parsed.data);
  },
  { auth: "none", rateLimit: "sync" },
);
