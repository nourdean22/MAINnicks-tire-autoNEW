/**
 * lib/trpc/routers/system/notifications.ts
 *
 * Per-domain slice of the system router (mechanical split · 2026-05-31).
 * Exports a plain procedure-object that system.ts spreads back into
 * `systemRouter` — the client paths stay FLAT as `trpc.system.<proc>`.
 * Procedures moved VERBATIM · no behavior / input-schema / middleware
 * change. See system.ts for the recomposition.
 */

import { z } from "zod";
import { operatorProcedure, publicProcedure } from "../../trpc";
import { buildSystemHub } from "@/lib/services/system-hub";
import { cached } from "@/lib/utils/cache";
import {
  issueToken,
  listTokens,
  revokeToken,
} from "@/lib/auth/extension-token";
import { getSessionExpiry } from "@/lib/services/session-expiry";
import { recordClientError } from "@/lib/services/client-error";
import {
  saveSubscription,
  removeSubscription,
  VAPID_PUBLIC_KEY,
} from "@/lib/notifications/push";

export const notificationsProcedures = {
  /**
   * scattered-components slice · the lightweight session-expiry probe ·
   * decodes the NextAuth JWT cookie + returns `{ expires }`. Replaces
   * GET /api/auth/expires · delegates to the shared
   * `session-expiry.getSessionExpiry` the REST route also calls · drift
   * impossible. The SessionExpiryBanner polls this on a 30-120s
   * interval. PUBLIC procedure — the legacy route is ungated (it just
   * decodes the cookie · a missing / expired / tampered token resolves
   * `{ expires: null }` and the banner stays silent · real 401
   * enforcement lives in middleware). Reads the cookie off
   * `ctx.headers`.
   */
  sessionExpiry: publicProcedure.query(async ({ ctx }) => {
    // ctx.headers is populated by createTRPCContext (the App Router
    // fetch handler) · absent only from createServerContext callers,
    // which never hit this probe. Fall back to empty headers → the
    // service resolves `{ expires: null }`, never throws.
    return getSessionExpiry(ctx.headers ?? new Headers());
  }),

  /**
   * scattered-components slice · owner-only · ingest one client-side
   * error (unhandled error / promise rejection / error-boundary trip)
   * into ErrorLog. Replaces POST /api/errors · delegates to the shared
   * `client-error.recordClientError` the REST route also calls · drift
   * impossible. ClientErrorTelemetry fires this fire-and-forget. The
   * write is best-effort · the service swallows write failures and
   * always resolves `{ ok: true }` (telemetry must never surface its
   * own failure). The route's `kind` whitelist is hoisted to a strict
   * `z.enum` at the `.input()` boundary.
   */
  recordClientError: operatorProcedure
    .input(
      z.object({
        kind: z.enum(["error", "unhandledrejection", "boundary"]),
        message: z.string().min(1).max(4000),
        stack: z.string().max(20_000).optional(),
        url: z.string().max(2000).optional(),
        userAgent: z.string().max(1000).optional(),
        timestamp: z.number().finite().optional(),
        componentStack: z.string().max(10_000).optional(),
        errorBoundary: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input }) => recordClientError(input)),

  /**
   * Phase VV · owner-only · the /system hub landing-page rollup — one
   * compact payload feeding every subsurface card's live chip.
   * Replaces GET /api/system/hub · delegates to the shared
   * `system-hub.buildSystemHub` service. SystemHubGrid polls this on a
   * 60s interval — now driven by refetchInterval. The legacy route
   * wrapped the payload in `{ data }`; the procedure returns it
   * unwrapped and the call-site reads it directly.
   */
  // 2026-08-19 · cached 30s: buildSystemHub fans out into ~20 DB reads
  // (incl. the stale-data scanner) and is polled at 60s by BOTH the
  // Home health chip and the hub grid — it was the slowest member of
  // Home's single blocking tRPC batch, uncached. 30s TTL halves the
  // worst-case staleness relative to the 60s poll.
  hub: operatorProcedure.query(async () =>
    cached("trpc:system-hub", 30, () => buildSystemHub()),
  ),

  // ════════════ Phase B.6c · ultron system-domain sub-slice ════════════
  //
  // The 6 components/ultron/* cards targeting /api/system/* endpoints.
  // Each procedure delegates to a shared lib/services/ function the
  // legacy REST route ALSO calls · drift structurally impossible. The
  // 4 structured-write inputs use SHARED z.object schemas from
  // @/lib/validators/system (NOT permissive z.record · the
  // typed-payload-mismatch guard). Read procedures return the explicit
  // shallow service shapes — the Prisma Json columns the services touch
  // are projected to scalar / `unknown` inside the service, so the
  // public AppRouter type stays shallow (TS2589 firewall).

  /**
   * hooks-lib slice · the Web-Push VAPID public key (so the client can
   * subscribe). Replaces the GET branch of /api/notifications/subscribe
   * · returns the same `VAPID_PUBLIC_KEY` from `lib/notifications/push`
   * the legacy route returned · drift impossible.
   *
   * PUBLIC procedure — the VAPID public key is non-sensitive by
   * design (it's meant to ship to every browser); the legacy GET was
   * ungated for the same reason. `usePushNotifications` reads
   * `{ publicKey }` off this before calling `pushSubscribe`.
   */
  pushVapidKey: publicProcedure.query(() => ({
    publicKey: VAPID_PUBLIC_KEY,
  })),

  /**
   * hooks-lib slice · owner-only · register a Web-Push subscription.
   * Replaces the POST branch of /api/notifications/subscribe ·
   * delegates to the same `saveSubscription` helper the legacy route
   * calls · drift impossible. The `subscription` shape is strict
   * (endpoint + p256dh + auth keys) — the route's manual
   * `!subscription?.endpoint || !subscription?.keys?.p256dh` guard
   * hoisted to the typed `.input()`. Returns `{ success: true }`
   * mirroring the legacy envelope.
   */
  pushSubscribe: operatorProcedure
    .input(
      z.object({
        subscription: z.object({
          endpoint: z.string().min(1).max(2000),
          keys: z.object({
            p256dh: z.string().min(1).max(500),
            auth: z.string().min(1).max(500),
          }),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      await saveSubscription(input.subscription);
      return { success: true as const };
    }),

  /**
   * hooks-lib slice · owner-only · remove a Web-Push subscription.
   * Replaces the DELETE branch of /api/notifications/subscribe ·
   * delegates to the same `removeSubscription` helper the legacy route
   * calls · drift impossible. Returns `{ success: true }` mirroring the
   * legacy envelope.
   */
  pushUnsubscribe: operatorProcedure
    .input(z.object({ endpoint: z.string().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      await removeSubscription(input.endpoint);
      return { success: true as const };
    }),

  /**
   * P4 · Chrome extension · personal API token CRUD. Operator-only.
   * Tokens are sha256-hashed at rest · the RAW token is returned ONCE
   * on issue (UI must display + offer copy) and never re-readable.
   */
  apiTokensList: operatorProcedure.query(async () => {
    return listTokens();
  }),
  apiTokensIssue: operatorProcedure
    .input(z.object({ label: z.string().min(1).max(64), scope: z.string().max(64).optional() }))
    .mutation(async ({ input }) => {
      return issueToken(input);
    }),
  apiTokensRevoke: operatorProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return revokeToken(input.id);
    }),
};
