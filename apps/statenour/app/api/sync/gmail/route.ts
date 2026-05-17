import { syncHandler } from "@/lib/utils/http";
import { processGmailItems } from "@/lib/integrations/gmail-sync";
import { ServiceError } from "@/lib/utils/service-error";

/** POST /api/sync/gmail — Push Gmail items into statenour-os */
export const POST = syncHandler(async (req) => {
  const body = await req.json();
  const items = body.items ?? body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new ServiceError("items array required", 400);
  }

  return processGmailItems(items);
});
