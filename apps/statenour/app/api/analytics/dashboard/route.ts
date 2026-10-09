import { apiHandler } from "@/lib/utils/http";
import { getDashboardSummary } from "@/lib/services/business-intel";
import { redactUnreadableSections } from "@/lib/ai/tools/bridge-honesty";

// getDashboardSummary carries each section's zero defaults beside a
// `bridgeHealth.<section>: false` marker when its shop-bridge read failed. Sent
// as-is, an unread month or customer count reached the caller as a confident 0
// (`customers: { total: 0, newThisMonth: 0 }` beside `customers: false`). The
// same redaction as the Nick tool and the deep lane: an unread section is null
// and named in `unavailable`; a fully readable summary is returned unchanged.
export const GET = apiHandler(async () => {
  return redactUnreadableSections(await getDashboardSummary());
}, { auth: "owner" });
