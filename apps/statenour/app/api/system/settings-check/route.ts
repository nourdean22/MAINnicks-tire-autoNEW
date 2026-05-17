/**
 * GET /api/system/settings-check  ·  owner-auth
 *
 * Probes every endpoint that /settings fires on load. Returns a
 * per-endpoint status + latency + the first 240 chars of the
 * response so Nour can see at a glance which one is actually broken.
 *
 * Nour's question: "what's failing to load when i open up settings".
 * Without this, every failure is silently swallowed by the panels
 * themselves — they just render empty or stale. This endpoint
 * surfaces the truth in one JSON blob.
 *
 * Called endpoints (in parallel):
 *   · /api/settings/autopilot            — autopilot flags
 *   · /api/tools/health                  — tool dep health
 *   · /api/brain/status                  — memory + patterns + rules
 *   · /api/brain/maturity                — brain maturity header
 *   · /api/settings/ai-config            — AI config panel
 *   · /api/drive/sync                    — cold-memory stats
 *   · /api/settings/crons                — cron control panel
 *   · /api/skills                        — skill library panel
 *   · /api/identity?history=1            — identity panel
 *   · /api/system/pulse                  — system ops pulse
 */

import { apiHandler } from "@/lib/utils/http";
import { headers } from "next/headers";

// Force dynamic — this route reads cookies + hits other endpoints, so
// it can never be statically rendered. Without this, Next 16 can end
// up serving a stale not-found during the first minute post-deploy.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ProbeResult {
  path: string;
  status: number;
  ok: boolean;
  ms: number;
  preview: string;
  error?: string;
}

const SETTINGS_LOAD_CALLS = [
  "/api/settings/autopilot",
  "/api/tools/health",
  "/api/brain/status",
  "/api/brain/maturity",
  "/api/settings/ai-config",
  "/api/drive/sync",
  "/api/settings/crons",
  "/api/skills",
  "/api/identity?history=1",
  "/api/system/pulse",
] as const;

export const GET = apiHandler(
  async (req) => {
    // Build the absolute base URL from the incoming request so we
    // hit the same deployment (preview vs prod) the caller is on.
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") || "https";
    const base = host ? `${proto}://${host}` : new URL(req.url).origin;

    // Forward the caller's auth cookie so each probe inherits the
    // owner session (otherwise every owner-gated endpoint 401s).
    const cookie = h.get("cookie") ?? "";

    const startedAt = Date.now();
    const results: ProbeResult[] = await Promise.all(
      SETTINGS_LOAD_CALLS.map(async (path): Promise<ProbeResult> => {
        const t0 = Date.now();
        try {
          const res = await fetch(`${base}${path}`, {
            headers: cookie ? { cookie } : {},
            cache: "no-store",
            // Fail fast — settings loads should be well under 10s each.
            signal: AbortSignal.timeout(10_000),
          });
          const text = await res.text().catch(() => "");
          return {
            path,
            status: res.status,
            ok: res.ok,
            ms: Date.now() - t0,
            preview: text.slice(0, 240),
          };
        } catch (err) {
          return {
            path,
            status: 0,
            ok: false,
            ms: Date.now() - t0,
            preview: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    const failing = results.filter((r) => !r.ok);

    return {
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      total: results.length,
      ok: results.length - failing.length,
      failing: failing.length,
      // Failing endpoints first so the answer is obvious.
      results: [
        ...failing,
        ...results.filter((r) => r.ok).sort((a, b) => b.ms - a.ms),
      ],
    };
  },
  { auth: "owner" },
);
