/**
 * lib/trpc/routers/browser.ts · Phase LL (2026-05-18 PM).
 *
 * Browser-tool surface · the 5th domain router (nick · operator ·
 * system · chat · browser). Wraps Browserbase session lifecycle so
 * the BrowserSandbox panel + future `browser_do` tool flows can
 * coordinate on the same typed surface.
 *
 * Delegates to the existing `lib/integrations/browserbase` adapter ·
 * the legacy REST endpoints at `app/api/browser/session/route.ts`
 * call the same module · drift between consumers structurally
 * impossible.
 *
 * Not-configured surface · BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID
 * being unset surfaces as PRECONDITION_FAILED so the panel can show
 * its onboarding hint cleanly instead of a generic 5xx.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, operatorProcedure } from "../trpc";
import {
  createSession,
  closeSession,
  getSession,
  listSessions,
  isConfigured,
} from "@/lib/integrations/browserbase";

function notConfigured(): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Browserbase not configured — set BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID",
  });
}

export const browserRouter = router({
  /**
   * Phase LL (2026-05-18 PM) · owner-only · list current Browserbase
   * sessions (active + recently closed). Powers the BrowserSandbox
   * panel's session roster + the "+ New session" empty-state.
   *
   * Lazy-on-open (panel sets enabled: open via React Query · no
   * polling when the panel is closed).
   */
  sessions: operatorProcedure.query(async () => {
    if (!isConfigured()) throw notConfigured();
    const res = await listSessions();
    if (!res.ok) {
      throw new TRPCError({
        code: res.code === "not_configured" ? "PRECONDITION_FAILED" : "BAD_GATEWAY",
        message: res.error,
      });
    }
    return { sessions: res.data };
  }),

  /**
   * Phase LL · owner-only · spin up a new keep-alive session and
   * return its liveViewUrl + connectUrl. Caller invalidates
   * `browser.sessions` to refresh the roster after success.
   */
  createSession: operatorProcedure.mutation(async () => {
    if (!isConfigured()) throw notConfigured();
    const res = await createSession({ keepAlive: true });
    if (!res.ok) {
      throw new TRPCError({
        code: res.code === "not_configured" ? "PRECONDITION_FAILED" : "BAD_GATEWAY",
        message: res.error,
      });
    }
    return { session: res.data };
  }),

  /**
   * Phase LL · owner-only · close a session by ID. Caller invalidates
   * `browser.sessions` to refresh the roster after success.
   */
  closeSession: operatorProcedure
    .input(z.object({ id: z.string().min(1).max(128) }))
    .mutation(async ({ input }) => {
      if (!isConfigured()) throw notConfigured();
      const res = await closeSession(input.id);
      if (!res.ok) {
        throw new TRPCError({
          code: res.code === "not_configured" ? "PRECONDITION_FAILED" : "BAD_GATEWAY",
          message: res.error,
        });
      }
      return { closed: true, session: res.data };
    }),

  /**
   * Phase LL · owner-only · single-session detail lookup (used by
   * `browser_do` tool flows for inflight session pickup). Not used
   * by BrowserSandbox itself · here for completeness.
   */
  session: operatorProcedure
    .input(z.object({ id: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      if (!isConfigured()) throw notConfigured();
      const res = await getSession(input.id);
      if (!res.ok) {
        throw new TRPCError({
          code: res.code === "not_configured" ? "PRECONDITION_FAILED" : "BAD_GATEWAY",
          message: res.error,
        });
      }
      return { session: res.data };
    }),
});
