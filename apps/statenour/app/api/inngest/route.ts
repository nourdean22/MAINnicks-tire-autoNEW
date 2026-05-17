/**
 * POST/PUT/GET /api/inngest · Wave-200 Phase 3 (2026-05-17)
 *
 * Inngest serve endpoint · the URL the Inngest control plane hits
 * to invoke any registered function. Acts as a polymorphic handler:
 *
 *   · GET  → introspection / health (Inngest's discovery probe)
 *   · POST → invoke a specific function step
 *   · PUT  → register the function manifest (signing-key required in prod)
 *
 * Dynamic import keeps Inngest off the cold path for routes that
 * don't use it · same pattern as the Mastra test endpoint.
 *
 * Signing: when both INNGEST_SIGNING_KEY and INNGEST_EVENT_KEY are
 * set (operator action item from ADR-0005) the serve handler enforces
 * HMAC signature verification on every request. In dev (no keys),
 * the handler still works for local iteration — Inngest's SDK
 * graceful-degrades to a dev shim that allows local invocation
 * without signing.
 *
 * See: docs/adr/0005-inngest-durable-workflows.md
 */

import { serve } from "inngest/next";
import { getInngest } from "@/src/inngest/client";
import * as functions from "@/src/inngest/functions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Max 240s · longest possible single step (legacy mega cron uses
// this same ceiling). Inngest itself doesn't enforce step duration
// here — Vercel/Railway request timeout does.
export const maxDuration = 240;

// `serve` returns an object with GET/POST/PUT handlers. We re-export
// them as Next.js route methods.
const handler = serve({
  client: getInngest(),
  // Spread every named export from functions/index.ts. Each function
  // self-declares its trigger (cron · event · etc.) so the handler
  // doesn't need to know what each one does.
  functions: Object.values(functions),
});

export const { GET, POST, PUT } = handler;
