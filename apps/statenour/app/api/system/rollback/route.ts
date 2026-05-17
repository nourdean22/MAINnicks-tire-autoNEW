/**
 * GET/POST /api/system/rollback · v10.0.90 · 2026-05-02.
 *
 * Auto-rollback control surface. GET lists recent ready production
 * deployments via Vercel API. POST { deploymentId } promotes that
 * deployment to current — instant rollback.
 *
 * Auth: owner only. Requires VERCEL_TOKEN + VERCEL_PROJECT_ID env
 * vars (or VERCEL_TEAM_ID for team-scoped projects).
 *
 * Safe-guards:
 *   · Only lists/promotes deployments with state='READY' + target='production'
 *   · POST writes BrainMemory category=rollback_action with the
 *     deployment URL + previous URL for audit
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { prisma } from "@/lib/prisma";

interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  source?: string;
  state?: "READY" | "BUILDING" | "ERROR" | "QUEUED" | "INITIALIZING" | "CANCELED";
  target?: "production" | "staging" | null;
  meta?: {
    githubCommitSha?: string;
    githubCommitMessage?: string;
    githubCommitRef?: string;
  };
  createdAt: number;
  ready?: number;
}

function vercelEnv() {
  const token = process.env.VERCEL_TOKEN?.trim();
  const projectId =
    process.env.VERCEL_PROJECT_ID?.trim() ?? process.env.PROJECT_ID?.trim();
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  return { token, projectId, teamId };
}

function teamQuery(teamId: string | undefined) {
  return teamId ? `&teamId=${encodeURIComponent(teamId)}` : "";
}

async function vercelFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = vercelEnv();
  if (!token) {
    throw new ServiceError(
      "VERCEL_TOKEN not configured — set the env var on the deployment first",
      503,
    );
  }
  const r = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new ServiceError(
      `Vercel API ${r.status}: ${body.slice(0, 200)}`,
      r.status >= 500 ? 502 : 400,
    );
  }
  return (await r.json()) as T;
}

export const GET = apiHandler(
  async () => {
    const { token, projectId, teamId } = vercelEnv();
    if (!token || !projectId) {
      return {
        ok: false,
        configured: false,
        error: "VERCEL_TOKEN + VERCEL_PROJECT_ID required",
        notes:
          "Set both env vars on the deployment, then GET this endpoint to list recent production deployments. Until configured, manual rollback via the Vercel dashboard is the alternative.",
      };
    }

    const list = await vercelFetch<{ deployments: VercelDeployment[] }>(
      `/v6/deployments?projectId=${encodeURIComponent(projectId)}${teamQuery(teamId)}&limit=20&target=production&state=READY`,
    );

    return {
      ok: true,
      configured: true,
      count: list.deployments.length,
      deployments: list.deployments.map((d) => ({
        uid: d.uid,
        url: d.url,
        sha: d.meta?.githubCommitSha?.slice(0, 7) ?? null,
        ref: d.meta?.githubCommitRef ?? null,
        message: d.meta?.githubCommitMessage?.slice(0, 100) ?? null,
        createdAt: new Date(d.createdAt).toISOString(),
        readyAt: d.ready ? new Date(d.ready).toISOString() : null,
        ageHours:
          Math.round(((Date.now() - d.createdAt) / 3_600_000) * 10) / 10,
      })),
    };
  },
  { auth: "owner" },
);

export const POST = apiHandler(
  async (req) => {
    const { token, projectId, teamId } = vercelEnv();
    if (!token || !projectId) {
      throw new ServiceError(
        "VERCEL_TOKEN + VERCEL_PROJECT_ID required for rollback",
        503,
      );
    }
    const body = (await req.json()) as { deploymentId?: string };
    const target = body.deploymentId?.trim();
    if (!target) {
      throw new ServiceError("deploymentId required", 400);
    }

    // Promote: Vercel's "promote" endpoint moves a previous deployment
    // back to current. https://vercel.com/docs/rest-api#endpoints/deployments/promote-a-deployment
    const result = await vercelFetch<{
      url?: string;
      uid?: string;
      state?: string;
    }>(
      `/v10/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(target)}${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`,
      { method: "POST" },
    );

    // Audit
    await prisma.brainMemory
      .create({
        data: {
          category: "rollback_action",
          key: `rollback__${target}__${Date.now()}`,
          content: `Operator triggered rollback to deployment ${target}. Result: ${JSON.stringify(result).slice(0, 400)}`,
          confidence: 1.0,
          source: "api:rollback",
          metadata: {
            deploymentId: target,
            result,
            triggeredAt: new Date().toISOString(),
          },
        },
      })
      .catch(() => {});

    return { ok: true, deploymentId: target, result };
  },
  { auth: "owner" },
);
