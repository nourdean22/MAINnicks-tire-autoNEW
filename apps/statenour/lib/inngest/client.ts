/**
 * Inngest client · Wave-200 Phase 3 (2026-05-17)
 *
 * Single Inngest client for all durable workflows in statenour-web.
 * Inngest is the *control plane* — actual work runs in the same
 * Next.js process via the serve endpoint at `/api/inngest`.
 *
 * Why Inngest:
 *   · `step.run` checkpoints — each step is retried independently on
 *     failure · no more "30-job fan-out fails and we lose the 29
 *     successes" · the failed step retries with backoff while siblings
 *     stay green.
 *   · `step.waitForEvent` — long-running operator workflows can pause
 *     for confirmation ("Telegram me before sending this") without
 *     blocking a worker. Replaces the home-grown setTimeout patterns.
 *   · Native cron triggers — replaces Vercel/Railway cron HTTP
 *     scheduling for the workflows we move over. Existing crons stay
 *     on their current platform during the cutover.
 *   · OOTB dashboard for runs · failures · retries — observability
 *     that the current setTimeout + cronJobLog pattern lacks.
 *
 * Cost: $0 on the free tier (50K function runs / month). Our current
 * mega-fanout runs twice daily × ~30 jobs = ~1,800 runs/month. Even
 * if we move every cron we stay well inside free.
 *
 * Operator action item:
 *   1. Create Inngest account at https://app.inngest.com (free)
 *   2. Create app "statenour-web" in the dashboard
 *   3. Copy `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` into Railway
 *      statenour-web env vars
 *   4. Connect the serve endpoint: paste
 *      `https://bdnick.info/api/inngest` into the dashboard's
 *      "Apps" page
 *
 * Until step 3-4 complete, the serve endpoint returns the function
 * registry in dev mode (no signing) so we can iterate on workflow
 * shape locally before flipping the prod key.
 *
 * See: docs/adr/0005-inngest-durable-workflows.md
 */

import { Inngest } from "inngest";

const APP_ID = "statenour-web";

// Lazy singleton · same pattern as Mastra. Don't pay the construction
// cost on cold paths that don't fire workflows.
let _client: Inngest | null = null;

export function getInngest(): Inngest {
  if (_client) return _client;
  _client = new Inngest({
    id: APP_ID,
    // eventKey is read from env automatically (INNGEST_EVENT_KEY)
    // when running in prod · the SDK falls back to a dev shim when
    // unset, which is what we want for local + first-deploy graceful
    // degrade.
  });
  return _client;
}

/**
 * Whether Inngest is "fully wired" (both event key + signing key set).
 * Used by the serve endpoint to decide whether to enforce signing.
 *
 * Same defensive pattern as `isBraintrustActive()` — we ship the code
 * before the operator pastes the credentials, and we degrade gracefully.
 */
export function isInngestFullyConfigured(): boolean {
  return Boolean(
    (process.env.INNGEST_EVENT_KEY ?? "").trim() &&
    (process.env.INNGEST_SIGNING_KEY ?? "").trim()
  );
}

/**
 * App ID exported so the serve endpoint + tests reference the same string.
 */
export const INNGEST_APP_ID = APP_ID;
