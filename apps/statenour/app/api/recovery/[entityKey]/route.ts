import { updateRecoveryItem } from "@/lib/services/recovery";
import { handleRouteError, jsonOk, readRequestJson } from "@/lib/utils/http";
import { recoveryUpdateSchema } from "@/lib/validators/recovery";

import { requireSession } from "@/lib/auth-guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      entityKey: string;
    }>;
  }
) {
  await requireSession(request);
  try {
    const { entityKey } = await context.params;
    const input = recoveryUpdateSchema.parse(await readRequestJson(request));
    const updated = await updateRecoveryItem(entityKey, {
      status: input.status,
      note: input.note || null,
      callbackNote: input.callbackNote || null,
      nextFollowUpAt: input.nextFollowUpAt || null,
      outcome: input.outcome || null,
      expectedValue: input.expectedValue ?? null
    });

    return jsonOk({
      success: true,
      item: updated,
      latestActionSummary: updated.recent_actions?.[0] || null
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
