/**
 * Inngest deploy-time self-sync · 2026-07-28 cron-truth hardening.
 *
 * THE INCIDENT THIS PREVENTS: Railway has no Inngest deploy integration,
 * so the Cloud app's function manifest only updates on a manual
 * `PUT /api/inngest`. Between the last manual sync and 2026-07-28,
 * ~16 cron-triggered functions (morning brief, proactive push, approval
 * sweeper, the cron-heartbeat watchdog itself) were registered in code
 * and INVISIBLE to Inngest Cloud — scheduled by nobody, silently, for
 * weeks. The re-sync that fixed it returned `modified: true`: the drift
 * was real. See docs/audits/2026-07-28-cron-truth.md, Finding 1.
 *
 * THE FIX: every server boot self-syncs once. A deploy IS a boot on
 * Railway, so the manifest can never drift past a single deploy again.
 *
 * Contract:
 *   - Fire-and-forget, fail-open: a sync failure logs and never affects
 *     boot (the app serves fine without it — functions just keep their
 *     previous registration).
 *   - Delayed ~20s so the HTTP listener is up before we call ourselves.
 *   - Prod-gated via shouldSelfSync (pure, tested): needs the signing
 *     key (no key = dev shim, nothing to sync) and skips the build
 *     phase. Dev boots skip — local Inngest uses the dev server flow.
 *   - Targets the stable service URL (APP_BASE_URL || Railway platform
 *     URL), same policy as the mega fan-out's getBaseUrl: never the
 *     browser-facing custom domain.
 */
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/self-sync");

const SYNC_DELAY_MS = 20_000;

/** Pure gate — exported for tests. */
export function shouldSelfSync(env: {
  NEXT_PHASE?: string;
  INNGEST_SIGNING_KEY?: string;
  NODE_ENV?: string;
}): boolean {
  if (env.NEXT_PHASE === "phase-production-build") return false; // build, not a server
  if (!env.INNGEST_SIGNING_KEY?.trim()) return false; // dev shim / not configured
  if (env.NODE_ENV !== "production") return false; // local dev uses inngest dev flow
  return true;
}

function getSelfBaseUrl(): string {
  // Same policy as mega-fanout's getBaseUrl: stable service URL, never
  // the custom domain (domain swaps must not break service-to-service).
  return (
    process.env.APP_BASE_URL?.trim() ||
    "https://statenour-web-production.up.railway.app"
  );
}

/** Schedule the one-shot boot sync. Called from instrumentation.ts. */
export function scheduleInngestSelfSync(): void {
  if (!shouldSelfSync(process.env as Record<string, string | undefined>)) {
    return;
  }
  const timer = setTimeout(async () => {
    try {
      const res = await fetch(`${getSelfBaseUrl()}/api/inngest`, {
        method: "PUT",
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.text().catch(() => "");
      // Spine-1: verify the OUTCOME, not the invocation — pre-fix a
      // 401/404/500 logged as an informational line and the drift class
      // this mechanism exists to prevent would have sailed through.
      if (!res.ok) {
        log.warn("inngest_self_sync_failed", {
          status: res.status,
          body: body.slice(0, 200),
        });
        return;
      }
      let modified: boolean | null = null;
      try {
        const parsed = JSON.parse(body) as { modified?: unknown };
        modified = typeof parsed.modified === "boolean" ? parsed.modified : null;
      } catch {
        // Inngest answered 2xx with a non-JSON body — registration state
        // unknown; say so instead of treating any body as proof.
        log.warn("inngest_self_sync_unverified", {
          status: res.status,
          body: body.slice(0, 160),
        });
        return;
      }
      // modified:true = the Cloud manifest CHANGED on this boot — this
      // mechanism just prevented a repeat of the 2026-07-28 drift.
      log.info("inngest_self_sync", {
        status: res.status,
        modified,
        body: body.slice(0, 160),
      });
    } catch (err) {
      // Fail-open by contract — never affects the running server.
      log.warn("inngest_self_sync_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }, SYNC_DELAY_MS);
  // Never keep the process alive just for the sync timer.
  timer.unref?.();
}
