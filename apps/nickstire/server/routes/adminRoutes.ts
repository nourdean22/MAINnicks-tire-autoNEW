import type { Express } from "express";
import express from "express";
import { timingSafeEqual } from "crypto";

import { createLogger } from "../lib/logger";
import { errorTelemetry } from "../lib/error-telemetry";
import { getAllBreakerHealth, resetAllBreakers } from "../lib/circuit-breaker";

const serverLog = createLogger("server");

// ─── Admin API Key middleware (shared by all admin REST endpoints) ───
// Exported because /api/health/recover (in server/_core/index.ts) wires
// it as route middleware. It was previously a hoisted function decl in
// index.ts and referenced before its declaration; the named export keeps
// that call site resolving via a module-top import.
export function requireAdminApiKey(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || typeof auth !== "string") {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const expectedFull = `Bearer ${expected}`;
  if (auth.length !== expectedFull.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expectedFull))) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export function registerAdminRoutes(app: Express): void {
  // ─── Real-time SSE for admin dashboards ─────────────────
  // Auth is enforced INSIDE sseHandler via the admin's OAuth session cookie
  // (sdk.authenticateRequest → role === "admin"), with the ADMIN_API_KEY
  // Bearer as a server-to-server fallback. We deliberately do NOT use
  // requireAdminApiKey here: the browser transport is EventSource, which
  // cannot send an Authorization header, so a Bearer-only gate 401'd every
  // dashboard connection. The route stays admin-only — just via the cookie
  // the admin actually carries.
  import("../services/realtimePush").then(({ sseHandler }) => {
    app.get("/api/admin/events", sseHandler);
    serverLog.info("SSE endpoint registered: /api/admin/events (session-auth-gated)");
  }).catch(e => serverLog.warn("[server:init] SSE endpoint registration failed", { error: e instanceof Error ? e.message : String(e) }));

  // ─── Cron Status (admin) ──────────────────────────────
  app.get("/api/admin/cron-status", requireAdminApiKey, (req, res) => {
    import("../cron/index").then(({ getJobStatuses }) => {
      res.json({ jobs: getJobStatuses(), timestamp: new Date().toISOString() });
    }).catch(() => res.json({ jobs: [], error: "Failed to load cron status" }));
  });

  // ─── Run pending migrations (admin · idempotent) ──────
  // POST /api/admin/run-migrations — applies the hand-written DDL array in
  // handleRunMigrations (all CREATE TABLE IF NOT EXISTS / INSERT IGNORE /
  // catch-Duplicate, safe to re-run). Curl-able with ADMIN_API_KEY so
  // migrations apply headlessly without TiDB creds OR an authed browser
  // session — the old "authed admin-tab Chrome fetch" path broke under the
  // browser MCP's injected-authenticated-mutation guard. Returns the same
  // { success, applied, skipped, total, errors? } the tRPC runMigrations does.
  app.post("/api/admin/run-migrations", requireAdminApiKey, async (_req, res) => {
    try {
      const { handleRunMigrations } = await import("../routers/nick/intelligence");
      res.json(await handleRunMigrations());
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ─── Fire IG autopost once (admin · respects IG_AUTOPOST_DRYRUN) ──
  // POST /api/admin/ig-autopost-fire — headless trigger for the autonomous
  // IG+FB poster. In dryrun mode (the default until IG_AUTOPOST_DRYRUN=false)
  // it generates + dual-evals + sends a Telegram PREVIEW without posting, and
  // returns the run summary (status/scores). The full caption + image land in
  // Telegram (notifyPreview) and ig_autopost_log. Mirrors the tRPC
  // fireIgAutopostNow so the dryrun can be reviewed without a browser session.
  app.post("/api/admin/ig-autopost-fire", requireAdminApiKey, async (req, res) => {
    try {
      const { runIgAutopostOneOff } = await import("../services/igAutopost");
      const archetype = req.body?.archetype || req.query?.archetype;
      res.json(await runIgAutopostOneOff(archetype));
    } catch (e) {
      res.status(500).json({ status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ─── Photo Assess (admin manual trigger · Wave AZ) ──
  // POST /api/admin/photo-assess  · body: { phone, photoUrl, skipSmsSend? }
  // Manual fire-button for testing the photo-damage MMS pipeline OR
  // for operator-driven response to a photo received outside the
  // normal MMS path (e.g. customer Facebook-DM'd a photo). The
  // pipeline runs vision analysis → optionally drafts SMS via NickGPT
  // → sends reply via shop gateway with { via: "shop" }. Returns the
  // structured assessment + send status.
  app.post("/api/admin/photo-assess", requireAdminApiKey, express.json({ limit: "8kb" }), async (req, res) => {
    const { phone, photoUrl, skipSmsSend } = (req.body || {}) as {
      phone?: string;
      photoUrl?: string;
      skipSmsSend?: boolean;
    };
    if (!phone || !photoUrl) {
      res.status(400).json({ error: "phone and photoUrl required" });
      return;
    }
    try {
      const { runPhotoAssess } = await import("../services/photo-assess-pipeline");
      const outcome = await runPhotoAssess({
        phone,
        photoUrl,
        source: "manual_admin",
        skipSmsSend: Boolean(skipSmsSend),
      });
      res.json(outcome);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── Feature Flag REST API (admin key auth) ────────
  app.get("/api/admin/flags", requireAdminApiKey, async (_req, res) => {
    const { getAllFlags } = await import("../services/featureFlags");
    res.json(await getAllFlags());
  });
  app.post("/api/admin/flags/toggle", requireAdminApiKey, express.json(), async (req, res) => {
    const { key, value } = req.body;
    if (!key || typeof value !== "boolean") { res.status(400).json({ error: "key and value required" }); return; }
    const { setFlag } = await import("../services/featureFlags");
    await setFlag(key, value);
    res.json({ key, value, toggled: true });
  });

  // ─── Error Telemetry Report (admin) ────────────────
  app.get("/api/admin/error-report", requireAdminApiKey, (_req, res) => {
    res.json({ ...errorTelemetry.getReport(), timestamp: new Date().toISOString() });
  });

  // ─── Circuit Breaker Health (admin) ───────────────
  app.get("/api/admin/circuit-breakers", requireAdminApiKey, (_req, res) => {
    res.json({ breakers: getAllBreakerHealth(), timestamp: new Date().toISOString() });
  });

  // ─── Circuit Breaker Reset (admin) ────────────────
  app.post("/api/admin/circuit-breakers/reset", requireAdminApiKey, (_req, res) => {
    resetAllBreakers();
    res.json({ success: true, breakers: getAllBreakerHealth(), timestamp: new Date().toISOString() });
  });

  // ─── VAPI Voice Latency Observability (admin) ────
  // wave-181.4 · migrated from statenour-os v10.0.527 Arc A F4 per the
  // business-separation directive. Surfaces P50/P95 per stage + breach
  // streak + recommended-delta from the voice_latency_events table.
  app.get("/api/admin/voice-latency", requireAdminApiKey, async (req, res) => {
    try {
      const days = Math.max(1, Math.min(90, parseInt(String(req.query.days || "7"), 10) || 7));
      const { getVoiceLatencyState } = await import("../services/voice-latency");
      const state = await getVoiceLatencyState(days);
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── VAPI Call State (admin · Phase 4 · wave-181.63) ────────
  // Real-time view of in-flight VAPI calls + their current state in
  // the 4-state agent flow (greeted → intent_captured → tool_called →
  // confirmed). Backed by voice_latency_events with `state_<name>`
  // stage namespacing · zero migration cost. Drill in to a single
  // call's full state trail via ?callId=<vapi-uuid>.
  app.get("/api/admin/voice-call-states", requireAdminApiKey, async (req, res) => {
    try {
      const callId = typeof req.query.callId === "string" ? req.query.callId : null;
      const maxAgeMinutes = Math.max(
        1,
        Math.min(120, parseInt(String(req.query.maxAgeMin || "10"), 10) || 10),
      );
      const { getActiveCallStates, getCallStateHistory } = await import(
        "../services/voice-call-state"
      );
      if (callId) {
        // Single-call drill-in · full state trail oldest → newest.
        const history = await getCallStateHistory(callId);
        res.json({ callId, history });
        return;
      }
      // Roster view · all in-flight calls within the lookback window.
      const active = await getActiveCallStates({ maxAgeMinutes });
      res.json({
        windowMinutes: maxAgeMinutes,
        count: active.length,
        states: active,
        byState: active.reduce<Record<string, number>>((acc, s) => {
          acc[s.latestState] = (acc[s.latestState] ?? 0) + 1;
          return acc;
        }, {}),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── VAPI Call Analytics (admin) ─────────────────
  // wave-181.4 · proxies VAPI's /call list endpoint with aggregations.
  // Migrated from statenour-os v10.0.269 (/api/system/vapi-calls).
  app.get("/api/admin/vapi-calls", requireAdminApiKey, async (req, res) => {
    const days = Math.max(1, Math.min(90, parseInt(String(req.query.days || "7"), 10) || 7));
    const since = new Date(Date.now() - days * 86_400_000);
    const apiKey = (process.env.VAPI_API_KEY || "").trim();
    if (!apiKey) {
      res.json({
        windowDays: days, sinceIso: since.toISOString(), totalCalls: 0,
        byStatus: {}, byEndedReason: {}, avgDurationSec: 0,
        mostRecent: null, totalCostUsd: 0, error: "VAPI_API_KEY not set",
      });
      return;
    }
    interface VapiCall {
      id: string;
      status?: string;
      endedReason?: string | null;
      createdAt?: string;
      startedAt?: string | null;
      endedAt?: string | null;
      cost?: number;
      costBreakdown?: { total?: number };
    }
    try {
      const r = await fetch(`https://api.vapi.ai/call?limit=100&createdAtGt=${encodeURIComponent(since.toISOString())}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        // wave-181.16 code-review F2 · was unbounded fetch. The cron
        // version uses AbortSignal.timeout(30_000). Admin tile UX wants
        // a faster fail, so 15s here so a slow VAPI doesn't starve the
        // Express request pool.
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        res.json({
          windowDays: days, sinceIso: since.toISOString(), totalCalls: 0,
          byStatus: {}, byEndedReason: {}, avgDurationSec: 0,
          mostRecent: null, totalCostUsd: 0, error: `VAPI returned ${r.status}`,
        });
        return;
      }
      // wave-181.16 code-review F5 · was assuming VAPI's default sort.
      // Explicit DESC sort so calls[0] is guaranteed-most-recent
      // regardless of upstream behavior changes.
      const calls = ((await r.json()) as VapiCall[])
        .filter((c) => c.createdAt)
        .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
      const byStatus: Record<string, number> = {};
      const byEndedReason: Record<string, number> = {};
      let durationSum = 0;
      let durationCount = 0;
      let costSum = 0;
      for (const c of calls) {
        byStatus[c.status ?? "(unknown)"] = (byStatus[c.status ?? "(unknown)"] ?? 0) + 1;
        byEndedReason[c.endedReason ?? "(none)"] = (byEndedReason[c.endedReason ?? "(none)"] ?? 0) + 1;
        if (c.startedAt && c.endedAt) {
          const durMs = new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime();
          if (durMs > 0) {
            durationSum += durMs;
            durationCount += 1;
          }
        }
        const cost = c.costBreakdown?.total ?? c.cost ?? 0;
        if (typeof cost === "number") costSum += cost;
      }
      const mostRecent = calls[0]
        ? {
            id: calls[0].id,
            createdAt: calls[0].createdAt,
            status: calls[0].status,
            endedReason: calls[0].endedReason,
            durationSec: calls[0].startedAt && calls[0].endedAt
              ? Math.round((new Date(calls[0].endedAt).getTime() - new Date(calls[0].startedAt).getTime()) / 1000)
              : null,
          }
        : null;
      res.json({
        windowDays: days, sinceIso: since.toISOString(), totalCalls: calls.length,
        byStatus, byEndedReason,
        avgDurationSec: durationCount > 0 ? Math.round(durationSum / durationCount / 1000) : 0,
        mostRecent, totalCostUsd: Number(costSum.toFixed(2)),
      });
    } catch (err) {
      // wave-181.16 code-review F4 · was returning bare { error } with 500,
      // diverging from the other two failure paths which return full shape
      // with 200. Statenour Ultron tile crashes if shape diverges. Now
      // uniformly returns the full shape with the error annotation.
      res.json({
        windowDays: days, sinceIso: since.toISOString(), totalCalls: 0,
        byStatus: {}, byEndedReason: {}, avgDurationSec: 0,
        mostRecent: null, totalCostUsd: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ─── Bridge endpoint for statenour Ultron tile (read-only) ───
  // wave-181.4 · the statenour Ultron voice-latency-tile reads from
  // this endpoint after the VAPI migration. Auth via STATENOUR_SYNC_KEY
  // bearer matching the existing bridge pattern.
  app.get("/api/bridge/voice-latency", async (req, res) => {
    // wave-181.15 · silent-failure audit Finding #1 (CRITICAL security):
    // was using plain === for secret compare. Even though network noise
    // makes the timing-attack slow, every other bridge endpoint in this
    // repo (statenour-bridge-routes.ts, bridge-routes.ts, vapi.ts) uses
    // timingSafeEqual with length guard — this one regressed. Aligned
    // with the project pattern.
    const expected = (process.env.STATENOUR_SYNC_KEY || "").trim();
    const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (
      !expected ||
      !got ||
      expected.length !== got.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(got))
    ) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const days = Math.max(1, Math.min(90, parseInt(String(req.query.days || "7"), 10) || 7));
      const { getVoiceLatencyState } = await import("../services/voice-latency");
      const state = await getVoiceLatencyState(days);
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
