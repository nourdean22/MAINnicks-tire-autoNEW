import { apiHandler } from "@/lib/utils/http";
import { getDashboardSummary } from "@/lib/services/business-intel";

export const GET = apiHandler(async () => {
  return getDashboardSummary();
}, { auth: "owner" });
