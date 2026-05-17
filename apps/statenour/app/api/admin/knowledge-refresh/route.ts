/**
 * /api/admin/knowledge-refresh — fan-out to all knowledge-pull crons.
 *
 * v6 · BATCH 6 · Apr 28. Single button, eight pulls. Lets Nour force-
 * refresh the whole knowledge corpus without waiting for the next cron
 * fire. Useful when:
 *   · Adding a new ALG invoice and wanting Nick to know about it
 *   · Pinning a new brand rule and wanting prompt cache flushed
 *   · Pulling fresh industry intel before generating a post
 *
 * Body: { only?: string[] }
 *   only — optional list of subsystems to refresh (else all)
 *
 * Returns: per-subsystem result + final cache flush.
 *
 * Auth: session.
 */

import { NextResponse } from "next/server";
import { hotFlushPromptCache } from "@/lib/ai/system-prompt-cache";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

interface RefreshBody {
  only?: string[];
}

const SUBSYSTEMS = [
  { id: "industry", path: "/api/cron/industry-pull", description: "automotive RSS feeds" },
  { id: "stories", path: "/api/cron/alg-stories-pull", description: "ALG customer stories" },
  { id: "insights", path: "/api/cron/insights-pull", description: "Meta IG/FB insights" },
  { id: "gmail", path: "/api/cron/ingest-gmail", description: "Gmail ingest" },
  { id: "calendar", path: "/api/cron/ingest-calendar", description: "Calendar ingest" },
  { id: "drive", path: "/api/cron/ingest-drive", description: "Drive doc ingest" },
  { id: "knowledge", path: "/api/cron/knowledge-sync", description: "Knowledge file sync" },
  { id: "embed", path: "/api/cron/embed-backfill", description: "Embedding backfill" },
];

export async function POST(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  let body: RefreshBody;
  try {
    body = (await req.json().catch(() => ({}))) as RefreshBody;
  } catch {
    body = {};
  }

  const targets = body.only && body.only.length > 0
    ? SUBSYSTEMS.filter((s) => body.only!.includes(s.id))
    : SUBSYSTEMS;

  if (targets.length === 0) {
    return NextResponse.json({ error: "no_targets" }, { status: 400 });
  }

  // v8.21 · the admin endpoint forwards CRON_SECRET to fan-out cron
  // routes. If it's not configured, those calls would 401 anyway, so
  // surface the misconfiguration clearly here instead of silently
  // failing every fan-out target.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured", code: "ENV_MISSING" },
      { status: 500 },
    );
  }
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const baseUrl = `${proto}://${host}`;

  const t0 = Date.now();
  const results = await Promise.allSettled(
    targets.map(async (sub) => {
      const tStart = Date.now();
      try {
        const res = await fetch(`${baseUrl}${sub.path}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${cronSecret}` },
          signal: AbortSignal.timeout(60_000),
        });
        const data = await res.json().catch(() => ({}));
        return {
          id: sub.id,
          path: sub.path,
          ok: res.ok,
          status: res.status,
          durationMs: Date.now() - tStart,
          summary: data.summary ?? data.message ?? `${res.status}`,
        };
      } catch (err) {
        return {
          id: sub.id,
          path: sub.path,
          ok: false,
          status: 0,
          durationMs: Date.now() - tStart,
          summary: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  // Final hot-flush so the next chat turn sees the freshly-refreshed knowledge
  hotFlushPromptCache(`admin knowledge-refresh — ${targets.length} subsystems`);

  const flat = results.map((r) => r.status === "fulfilled" ? r.value : { id: "?", path: "?", ok: false, status: 0, durationMs: 0, summary: r.reason });
  const succeeded = flat.filter((f) => f.ok).length;

  return NextResponse.json({
    ok: succeeded === targets.length,
    targets: targets.length,
    succeeded,
    failed: targets.length - succeeded,
    durationMs: Date.now() - t0,
    flushedPromptCache: true,
    results: flat,
  });
}
