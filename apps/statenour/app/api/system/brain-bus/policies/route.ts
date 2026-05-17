/**
 * GET /api/system/brain-bus/policies · v10.0.90 · 2026-05-02.
 *
 * Inspector for the per-topic retry policy registry. Returns the
 * full policy table so operators can see at a glance which topics
 * eventually-deliver vs best-effort vs escalate.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { listAllPolicies } from "@/lib/db/brain-bus-retry-policy";

export const GET = apiHandler(
  async () => {
    const policies = listAllPolicies();
    return {
      generatedAt: new Date().toISOString(),
      count: policies.length,
      policies,
      defaultPolicy: {
        maxAttempts: 5,
        backoffMinutes: [1, 5, 30, 120, 360],
        deadAction: "mark_dead",
      },
      notes:
        "Topics not listed use the default policy (5 attempts · 1m/5m/30m/2h/6h backoff · mark_dead). Override in lib/db/brain-bus-retry-policy.ts.",
    };
  },
  { auth: "owner" },
);
