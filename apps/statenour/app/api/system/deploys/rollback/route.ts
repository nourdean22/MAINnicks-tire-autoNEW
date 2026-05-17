/**
 * POST /api/system/deploys/rollback
 *
 * Rolls production back to the previous READY deploy. Calls the
 * Vercel API directly (no SDK dep). Owner-auth.
 *
 * Flow:
 *   1. List the last 10 deploys for this project.
 *   2. Identify the current production deploy (state=READY + target=production).
 *   3. Identify the next-most-recent READY deploy (the rollback target).
 *   4. Promote the rollback target to production via POST /v9/projects/{id}/promote/{deployId}.
 *
 * Envs required:
 *   VERCEL_TOKEN      — integration or personal access token
 *   VERCEL_TEAM_ID    — team_… ID (optional if personal)
 *   VERCEL_PROJECT_ID — prj_… ID (read from .vercel/project.json fallback)
 *
 * Returns 501 if VERCEL_TOKEN isn't set — the Builder UI treats 501
 * as "not implemented" and shows a graceful toast.
 */
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

const VERCEL_TOKEN = process.env.VERCEL_TOKEN ?? "";
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID ?? "";
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? "prj_CFa6JVJblNXaS5bIOOoLwkxh7g72";

interface VercelDeployment {
  uid: string;
  state: string;
  target?: string | null;
  created: number;
  meta?: { githubCommitSha?: string };
  url?: string;
}

async function vercelApi<T>(path: string, init?: RequestInit): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const teamSuffix = VERCEL_TEAM_ID ? `${sep}teamId=${VERCEL_TEAM_ID}` : "";
  const res = await fetch(`https://api.vercel.com${path}${teamSuffix}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ServiceError(`vercel ${res.status}: ${body.slice(0, 200)}`, 502);
  }
  return (await res.json()) as T;
}

export const POST = apiHandler(
  async () => {
    if (!VERCEL_TOKEN) {
      throw new ServiceError("VERCEL_TOKEN env not set — rollback unavailable", 501);
    }

    // 1. List last 10 production deploys, newest first
    const list = await vercelApi<{ deployments: VercelDeployment[] }>(
      `/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=10&target=production`,
    );
    const deploys = (list.deployments ?? []).filter((d) => d.state === "READY");
    if (deploys.length < 2) {
      throw new ServiceError("no previous READY deploy to roll back to", 409);
    }

    const [current, previous] = deploys;
    if (!previous?.uid) {
      throw new ServiceError("rollback target missing uid", 500);
    }

    // 2. Promote the previous deploy to production
    await vercelApi<unknown>(
      `/v9/projects/${VERCEL_PROJECT_ID}/promote/${previous.uid}`,
      { method: "POST" },
    );

    return {
      ok: true,
      demoted: {
        uid: current.uid,
        sha: current.meta?.githubCommitSha,
        url: current.url,
      },
      promoted: {
        uid: previous.uid,
        sha: previous.meta?.githubCommitSha,
        url: previous.url,
      },
    };
  },
  { auth: "owner" },
);
