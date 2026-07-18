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

  // ─── Reel Creative-Compiler canary (admin · headless full-chain drive) ──
  // POST /api/admin/reel-canary  · body: { action, jobId?, topic?, force? }
  // Drives ONE reel through the shipped Creative Compiler 2.0 chain on PROD
  // (prod Higgsfield session — never a local generation script, which would
  // rotate + strand prod's refresh token), with the M11 rendered-QA gate
  // ENFORCED before publish (the tRPC canary skips it). Curl-able with
  // ADMIN_API_KEY so it runs without an authed browser session. Actions:
  //   start   → generate brief (compiler) + autonomous visual world (image
  //             conditioning anchor) + prompt pack; enqueueReelJob runs the
  //             M10 preflight + spend/governor gates (throws on block).
  //   advance → pump ONE bounded render slice (recover + gen + assemble)
  //             under the HTTP timeout; call until status assembled/failed.
  //   qa      → runRenderedQaOnJob + orchestratePostQa → the M11 publish gate.
  //   publish → refuses unless the M11 gate returns "proceed" (or force=true,
  //             audited); posts through the ONE gated door (publishToSocial,
  //             itself REEL_PUBLISH_ENABLED-gated). Returns igPostId+permalink.
  app.post("/api/admin/reel-canary", requireAdminApiKey, express.json({ limit: "16kb" }), async (req, res) => {
    const action = String(req.body?.action || "");
    const jobId = Number(req.body?.jobId);
    const needsJob = () => {
      if (!Number.isInteger(jobId) || jobId <= 0) { res.status(400).json({ error: "jobId required (positive int)" }); return false; }
      return true;
    };
    try {
      if (action === "start") {
        const topic = (typeof req.body?.topic === "string" && req.body.topic.trim())
          || "The pothole that has been quietly eating Cleveland tires all winter";
        const maxAttempts = Number.isInteger(req.body?.maxAttempts)
          ? Math.min(6, Math.max(1, req.body.maxAttempts))
          : 4;
        const { prepareCleanReelBrief } = await import("../services/reelDraftPrep");
        const { resolveConditioningMode } = await import("../../client/src/lib/facelessReelStudio");
        const { enqueueReelJob } = await import("../services/reelPipeline");

        // Regenerates internally on an M10 preflight block (in-frame-text /
        // free-claim), so callers no longer loop start themselves.
        const { brief, attempts, rejectedForPreflight } = await prepareCleanReelBrief({ topic }, { maxAttempts });
        brief.id = `canary-${Date.now()}`;
        const conditioningMode = resolveConditioningMode(brief);
        const { jobId: newJobId } = await enqueueReelJob(brief, "admin");
        res.json({
          ok: true, action, jobId: newJobId, conditioningMode, attempts,
          preflightRejections: rejectedForPreflight.length,
          topic: brief.topic,
          hook: brief.captionHooks?.[0] ?? brief.mechanicTruth ?? null,
          caption: brief.selectedCaption ?? null,
          beats: Array.isArray(brief.storyboardBeats) ? brief.storyboardBeats.length : null,
        });
        return;
      }

      if (action === "advance") {
        if (!needsJob()) return;
        const { processNextReelJob, processNextAssemblyJob, recoverStuckReelJobs } = await import("../services/reelPipeline");
        const { getDb } = await import("../db");
        const { reelJobs } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const d = await getDb();
        if (!d) { res.status(503).json({ error: "DB unavailable" }); return; }
        const readJob = async () => (await d.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1))[0];
        const TERMINAL = new Set(["assembled", "posted", "failed"]);
        const deadline = Date.now() + 100_000; // stay well under the edge timeout
        let job = await readJob();
        while (job && !TERMINAL.has(job.status) && Date.now() < deadline) {
          await recoverStuckReelJobs().catch(() => {});
          // job-scoped: never claim/spend on an unrelated older queued row.
          await processNextReelJob(jobId).catch(() => {});
          await processNextAssemblyJob(jobId).catch(() => {});
          await new Promise((r) => setTimeout(r, 2500));
          job = await readJob();
        }
        res.json({ ok: true, action, jobId, status: job?.status ?? "unknown", error: job?.error ?? null, mp4Url: job?.mp4Url ?? null });
        return;
      }

      if (action === "qa") {
        if (!needsJob()) return;
        const { runRenderedQaOnJob } = await import("../services/renderedQa");
        const verdict = await runRenderedQaOnJob(jobId);
        if (!verdict) { res.status(400).json({ error: "Rendered QA could not run (job missing, no mp4, or frame extraction failed) — see server logs" }); return; }
        const { orchestratePostQa } = await import("../services/postQaOrchestrator");
        const outcome = orchestratePostQa(verdict.findings);
        res.json({
          ok: true, action, jobId,
          decision: verdict.decision, critic: verdict.critic, framesEvaluated: verdict.framesEvaluated,
          findings: verdict.findings,
          automation: outcome.verdict, publishGate: outcome.publishGate, repairPlan: outcome.repairPlan,
        });
        return;
      }

      if (action === "publish") {
        if (!needsJob()) return;
        const force = req.body?.force === true;
        const { getDb } = await import("../db");
        const { reelJobs } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const d = await getDb();
        if (!d) { res.status(503).json({ error: "DB unavailable" }); return; }
        const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
        if (!job) { res.status(404).json({ error: "job not found" }); return; }
        if (job.status !== "assembled") { res.status(409).json({ error: `job not assembled (status=${job.status})` }); return; }
        if (!job.mp4Url) { res.status(409).json({ error: "job has no mp4Url" }); return; }

        // M11 gate ENFORCED at publish via the CONSOLIDATED gate (same one the
        // autonomous doors use). Refuse a real non-"proceed" gate unless the
        // operator explicitly forces. QA-unavailable is allowed (g.allowed=true).
        const { evaluateReelPublishGate } = await import("../services/qualityGate");
        const g = await evaluateReelPublishGate(jobId);
        const publishGate = g.gate;
        if (!g.allowed && !force) {
          res.status(412).json({ error: "rendered-QA publish gate did not return proceed", publishGate, findings: g.findings, reason: g.reason, hint: "pass force=true to override" });
          return;
        }

        // Atomic claim assembled -> publishing BEFORE the external Meta call, so
        // two concurrent/retried publishes can't both post (mirrors the
        // affectedRows-guarded CAS the pipeline stages use). The loser 409s.
        const { and } = await import("drizzle-orm");
        const claim = await d.update(reelJobs).set({ status: "publishing" }).where(and(eq(reelJobs.id, jobId), eq(reelJobs.status, "assembled")));
        const claimed = (claim[0] as unknown as { affectedRows?: number })?.affectedRows ?? 0;
        if (claimed !== 1) { res.status(409).json({ error: "job is already being published or is no longer assembled" }); return; }

        const { publishToSocial } = await import("../services/socialPublish");
        const { getInstagramPermalink } = await import("../services/metaSocial");
        let outcome;
        try {
          outcome = await publishToSocial({ platforms: ["instagram"], videoUrl: job.mp4Url, caption: job.caption || "" });
        } catch (pubErr) {
          // THREW — we cannot know whether Meta accepted the post. Do NOT restore
          // "assembled" (that risks double-publishing a live reel); park it for
          // reconciliation. A cleanly-returned failure below IS safe to restore.
          const msg = pubErr instanceof Error ? pubErr.message : String(pubErr);
          await d.update(reelJobs)
            .set({ status: "publish_ambiguous", error: `publish threw: ${msg.slice(0, 300)}` })
            .where(and(eq(reelJobs.id, jobId), eq(reelJobs.status, "publishing")));
          serverLog.error("[Admin] reel-canary publish threw — parked publish_ambiguous", { jobId, error: msg });
          res.status(502).json({ error: "publish threw — job parked as publish_ambiguous; verify on Instagram before retrying", detail: msg, publishGate });
          return;
        }
        const ig = Array.isArray(outcome.results)
          ? outcome.results.find((r: { platform: string; success?: boolean; postId?: string; error?: string }) => r.platform === "instagram")
          : undefined;
        if (!ig?.success) {
          // release the claim so a retry can re-attempt (publishing -> assembled)
          await d.update(reelJobs).set({ status: "assembled" }).where(and(eq(reelJobs.id, jobId), eq(reelJobs.status, "publishing")));
          res.status(502).json({ error: ig?.error ?? "publish failed", publishGate });
          return;
        }
        let permalink: string | null = null;
        try { if (ig.postId) permalink = await getInstagramPermalink(ig.postId); } catch { /* permalink best-effort */ }
        await d.update(reelJobs).set({ status: "posted", igPostId: ig.postId }).where(eq(reelJobs.id, jobId));
        res.json({ ok: true, action, jobId, igPostId: ig.postId ?? null, permalink, publishGate, forced: publishGate !== "proceed" });
        return;
      }

      res.status(400).json({ error: "unknown action", allowed: ["start", "advance", "qa", "publish"] });
    } catch (err) {
      // Drizzle wraps the driver error: err.message is only the query echo, the
      // real MySQL reason (e.g. "Data too long for column 'payload'") is on
      // err.cause. Surface both so a failed enqueue is diagnosable without logs.
      const msg = err instanceof Error ? err.message : String(err);
      const cause = (err as { cause?: unknown })?.cause;
      const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : undefined;
      serverLog.error("[Admin] reel-canary error", { action, error: msg, cause: causeMsg });
      res.status(500).json({ error: msg, cause: causeMsg, action });
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
  /**
   * Every reel job that is stuck, held, or ambiguous — with the SPECIFIC reason
   * and only the actions its surviving artifacts actually support.
   *
   * This exists because three reels sat in status "assembled" for two days and
   * nothing surfaced them. The gates added in #883/#885/#887 correctly refuse to
   * publish unscored media, but a hold nobody can see is indistinguishable from a
   * system that quietly stopped working.
   *
   * Actions come from MEASURED artifact reachability, never from status: all three
   * of those jobs had a populated mp4Url and a 404 behind it, so an action list
   * built on status would have offered Repair and Publish on empty jobs.
   */
  app.get("/api/admin/reel-jobs/attention", requireAdminApiKey, async (_req, res) => {
    try {
      const { db } = await import("../lib/db-helper");
      const d = await db();
      if (!d) { res.status(503).json({ error: "no database" }); return; }

      const { reelJobs } = await import("../../drizzle/schema");
      const { inArray, desc } = await import("drizzle-orm");
      // Non-terminal states only. "posted" is done; "failed" is already legible.
      const ATTENTION = ["assembled", "publishing", "publish_ambiguous", "queued", "generating", "assets_ready", "assembling", "repair_rendering"];
      const rows = await d.select().from(reelJobs).where(inArray(reelJobs.status, ATTENTION)).orderBy(desc(reelJobs.id)).limit(50);

      const { assessReelJob } = await import("../services/reelRecoverability");
      const { evaluateReelPublishGate } = await import("../services/qualityGate");

      const jobs = await Promise.all(
        rows.map(async (job: typeof rows[number]) => {
          // Only ask the gate about jobs far enough along to have a verdict;
          // asking about a queued job would report "unavailable" and read as a
          // defect rather than as "not there yet".
          let gateReason: string | undefined;
          if (job.status === "assembled") {
            try {
              // runIfMissing:false — this is a LIST view. Triggering rendered QA
              // here would download each master, extract frames and call the
              // vision model per job: minutes of latency and real model spend on
              // a page view. The first live call to this endpoint timed out doing
              // exactly that.
              const g = await evaluateReelPublishGate(job.id, { runIfMissing: false });
              if (!g.allowed) gateReason = `${g.gate}: ${g.reason}`;
            } catch (err) {
              gateReason = `quality gate could not be evaluated: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`;
            }
          }
          return assessReelJob(job, { gateReason });
        }),
      );

      res.json({
        count: jobs.length,
        // Surfaced explicitly so the operator can see at a glance how much of the
        // backlog is unrecoverable rather than merely blocked.
        unrecoverable: jobs.filter((j) => j.recoverability === "brief_only" || j.recoverability === "unrecoverable").length,
        jobs,
      });
    } catch (err) {
      serverLog.error("reel-jobs/attention failed", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Rebuild a reel's master from its surviving source clips — the free recovery
   * path for a job whose assembled mp4 was lost to ephemeral disk while the clips
   * (provider-hosted) survived.
   *
   * Deliberately NOT called "repair": it produces a different file with a different
   * hash, so the prior QA verdict and approval are invalidated by the service. The
   * job returns to "assembled" needing fresh QA before it can publish.
   */
  app.post("/api/admin/reel-jobs/reassemble", requireAdminApiKey, express.json({ limit: "4kb" }), async (req, res) => {
    const jobId = Number(req.body?.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: "jobId required (positive int)" });
      return;
    }
    try {
      const { reassembleFromClips } = await import("../services/reelReassemble");
      const result = await reassembleFromClips(jobId);
      // A refusal is a 409, not a 500: the job is in a state that does not permit
      // re-assembly, which is an answer rather than a fault.
      res.status(result.ok ? 200 : 409).json(result);
    } catch (err) {
      serverLog.error("reel reassemble failed", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Publishes that may or may not be live — an attempt with no recorded outcome.
   *
   * This is what `publish_ambiguous` gets reconciled AGAINST. A process killed
   * between Meta accepting a post and the database being updated leaves exactly
   * this shape, and without it no operator can tell a lost publish from a lost
   * response except by checking Instagram by hand.
   */
  app.get("/api/admin/publish-attempts/open", requireAdminApiKey, async (req, res) => {
    try {
      const mins = Number(req.query?.olderThanMinutes);
      const { findUnreconciledAttempts } = await import("../services/publishAttemptLedger");
      const open = await findUnreconciledAttempts(Number.isFinite(mins) && mins >= 0 ? mins : 15);
      res.json({ count: open.length, attempts: open });
    } catch (err) {
      serverLog.error("publish-attempts/open failed", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

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

  // ─── Google Drive Creative Vault OAuth (one-time operator consent) ───
  // /start is admin-key-gated and returns the consent URL as JSON (a browser
  // navigation can't carry the Bearer header). The Google-facing callback is
  // necessarily public-path but CSRF-bound to the state minted by /start and
  // stored server-side — a forged callback without the matching state is
  // rejected before any token exchange.
  app.get("/api/admin/drive-vault/start", requireAdminApiKey, async (_req, res) => {
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(503).json({ error: "database unavailable" });
      const { beginDriveConsent } = await import("../services/creativeVault");
      res.json(await beginDriveConsent(db));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/admin/drive-vault/status", requireAdminApiKey, async (_req, res) => {
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(503).json({ error: "database unavailable" });
      const { vaultConfigured } = await import("../services/creativeVault");
      res.json({ configured: await vaultConfigured(db) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/oauth/drive/callback", async (req, res) => {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    if (!code || !state) return res.status(400).send("Missing code/state");
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return res.status(503).send("Database unavailable");
      const { completeDriveConsent } = await import("../services/creativeVault");
      const { email } = await completeDriveConsent(db, code, state);
      serverLog.info("drive vault connected", { email: email ?? "(unknown)" });
      res
        .status(200)
        .type("html")
        .send("<html><body style=\"font-family:system-ui;padding:2rem\"><h2>Creative Vault connected</h2><p>Google Drive access granted. You can close this tab.</p></body></html>");
    } catch (err) {
      serverLog.error("drive vault callback failed", { error: err instanceof Error ? err.message : String(err) });
      res.status(400).send("Drive consent failed — restart from the admin console.");
    }
  });
}
