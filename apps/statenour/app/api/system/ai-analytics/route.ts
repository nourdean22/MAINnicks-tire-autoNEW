import { apiHandler } from "@/lib/utils/http";
import { getDailyCosts, getCostsByFeature, getCostsByModel, getTokenUsage } from "@/lib/services/ai-analytics";
import { checkBudget, getBudgetHistory } from "@/lib/ai/budget";

/** GET /api/system/ai-analytics — Full AI cost dashboard data */
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get("days") ?? "30", 10);

  const [dailyCosts, byFeature, byModel, tokenUsage, budget, budgetHistory] =
    await Promise.all([
      getDailyCosts(days),
      getCostsByFeature(days),
      getCostsByModel(days),
      getTokenUsage(days),
      checkBudget(),
      getBudgetHistory(7),
    ]);

  return {
    dailyCosts,
    byFeature,
    byModel,
    tokenUsage,
    budget,
    budgetHistory,
  };
}, { auth: "owner" }); // v9.1.14 · was leaking AI budget + token usage
