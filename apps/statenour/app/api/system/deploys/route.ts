/**
 * GET /api/system/deploys
 *
 * Recent commits on the deploy branch + their file diffs. Reads from
 * the GitHub API using GITHUB_TOKEN env. Returns the 20 most recent
 * commits with stats (files changed, additions, deletions) so the
 * /system/deploys page can show "what shipped in the last deploy".
 *
 * Also reads vercel.json from the repo HEAD so the page can show the
 * current function memory + maxDuration config per route.
 *
 * If GITHUB_TOKEN isn't set, returns a graceful empty response.
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. Single consumer
 * (builder-sandbox.tsx) reads top-level keys · returning raw
 * NextResponse to preserve shape.
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

const REPO = "nourdean22/statenour-os";
const BRANCH = "codex/ollama-local";

interface GhCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
  html_url: string;
  author: { login: string; avatar_url: string } | null;
}

interface GhCommitDetail {
  sha: string;
  stats: { additions: number; deletions: number; total: number };
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
  parents: Array<{ sha: string }>;
}

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const limit = Math.min(50, Number(url.searchParams.get("limit") || "15"));

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json({
        configured: false,
        hint: "Set GITHUB_TOKEN env var to enable deploy history",
        commits: [],
      });
    }

    const headers: HeadersInit = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "nour-os-deploys",
    };

    // 1. List commits on the deploy branch
    const listRes = await fetch(
      `https://api.github.com/repos/${REPO}/commits?sha=${BRANCH}&per_page=${limit}`,
      { headers }
    );

    if (!listRes.ok) {
      throw new ServiceError(`GitHub commits list failed: ${listRes.status}`, 502);
    }

    const commits = (await listRes.json()) as GhCommit[];

    // 2. Fetch stats for each commit in parallel (bounded to limit).
    //    Each /commits/:sha request returns stats + files.
    const details = await Promise.all(
      commits.slice(0, limit).map(async (c) => {
        try {
          const detailRes = await fetch(
            `https://api.github.com/repos/${REPO}/commits/${c.sha}`,
            { headers }
          );
          if (!detailRes.ok) return null;
          return (await detailRes.json()) as GhCommitDetail;
        } catch {
          return null;
        }
      })
    );

    const shaped = commits.map((c, i) => {
      const detail = details[i];
      const msg = c.commit.message;
      const [subject, ...rest] = msg.split("\n");
      const body = rest.join("\n").trim();
      return {
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        subject: subject.slice(0, 120),
        bodyPreview: body.slice(0, 600),
        bodyFull: body,
        author: c.commit.author.name,
        date: c.commit.author.date,
        url: c.html_url,
        stats: detail?.stats || null,
        files: detail?.files?.slice(0, 30) || [],
        parentSha: detail?.parents?.[0]?.sha || null,
      };
    });

    return NextResponse.json({
      configured: true,
      branch: BRANCH,
      repo: REPO,
      commits: shaped,
    });
  },
  { auth: "owner" },
);
