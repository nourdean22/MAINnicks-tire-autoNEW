/**
 * GET /api/system/deploys
 *
 * Recent commits on the deploy branch + per-commit stats. Used by
 * the BuilderSandbox panel + the /system/deploys page.
 *
 * Phase KK (2026-05-18 PM) · heavy lifting moved to
 * `lib/services/deploys.listDeployCommits` so both this REST endpoint
 * AND the new `trpc.system.deploys` query call the same function ·
 * drift between consumers structurally impossible. Stays mounted for
 * back-compat with any non-tRPC consumer.
 *
 * Owner-auth · gracefully returns empty when GITHUB_TOKEN unset.
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/utils/http";
import { listDeployCommits } from "@/lib/services/deploys";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const limit = Math.min(50, Number(url.searchParams.get("limit") || "15"));
    return NextResponse.json(await listDeployCommits({ limit }));
  },
  { auth: "owner" },
);
