/**
 * GET /api/system/cost-slo · v10.0.526 · Arc A · Feature 2
 *
 * Operator-facing SLO snapshot. Powers the upcoming cockpit tile.
 * Returns shape:
 *   { today, forecast, budget, sparkline7d, topConversations, byProvider }
 *
 * Auth: owner. AI cost telemetry stays gated.
 */

import { apiHandler } from "@/lib/utils/http";
import {
  computeBurnRateForecast,
  costByProvider,
  dailyBudgetCents,
  etDateKey,
  isOverBudget,
  sparkline7d,
  topConversationsByCost,
} from "@/lib/services/cost-slo";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    const [state, spark, top, providers] = await Promise.all([
      isOverBudget(),
      sparkline7d(),
      topConversationsByCost(7, 10),
      costByProvider(7),
    ]);

    const { burnCents, forecastCents, hoursElapsed } = await computeBurnRateForecast();
    const budget = dailyBudgetCents();
    const threshold = Math.round(budget * 1.2);

    return {
      date: etDateKey(),
      today: {
        burnCents,
        hoursElapsed: Number(hoursElapsed.toFixed(2)),
      },
      forecast: {
        forecastCents,
        thresholdCents: threshold,
        over: state.over,
      },
      budget: {
        dailyCents: budget,
        thresholdMultiplier: 1.2,
      },
      sparkline7d: spark,
      topConversations: top,
      byProvider: providers,
    };
  },
  { auth: "owner" },
);
