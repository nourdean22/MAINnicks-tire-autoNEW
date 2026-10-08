import type { Express } from "express";
import express from "express";
import { createLogger } from "../lib/logger";

const serverLog = createLogger("server");

// 2026-09-08 · the prerender regen boots THIS server (PRERENDER_MODE=true)
// against the production database and drives every public page through
// Puppeteer. index.ts skips crons and queues in that mode, but a page load
// still fires these beacons — the conversion sink wrote a customer_events row
// per rendered page on every weekly snapshot run. A rendering pass must never
// be a production write: every DB-writing sink below accepts the beacon and
// persists nothing. Same literal as index.ts ("true"), on purpose — "1" is
// not prerender mode anywhere in this server.
const isPrerenderPass = () => process.env.PRERENDER_MODE === "true";

// ─── Public analytics + telemetry sinks ─────────────────
// Extracted verbatim from server/_core/index.ts. Four anonymous
// beacon endpoints (conversion events, abandoned-form tracking, Uber
// drop-off codes, Core Web Vitals). Each keeps its OWN per-route
// express.json({ limit }) body parser — they are NOT collapsed to a
// shared router.use(), because each endpoint's payload ceiling differs
// and the per-route parser is the behavior contract.
export function registerAnalyticsRoutes(app: Express): void {
  // ─── Abandoned Form Tracking ──────────────────────────
  // Receives navigator.sendBeacon from BookingWizard on page unload
  // ─── Conversion-event sink ─────────────────────────────
  // The `useConversionTracking` hook on the client fans every CTA / form
  // / capture event here. Two destinations:
  //   1. In-memory ring buffer (`conversionEvents`) — the admin
  //      Conversion Preview live feed.
  //   2. feat/home-v2 (Phase 0): the customer_events table — the
  //      PERSISTED funnel source of truth. Before this, events died in
  //      the 500-item ring buffer on every restart, so conversion lift
  //      was unmeasurable. Rows carry sessionId + UTM (sent by the hook)
  //      and eventData.source="conversion_hook" to disambiguate from the
  //      trackEvent() pipeline (customerEvents.log), which can emit
  //      overlapping names like form_completed.
  app.post("/api/analytics/conversion", express.json({ limit: "8kb" }), async (req, res) => {
    try {
      if (isPrerenderPass()) return res.sendStatus(204);
      const body = req.body as Record<string, unknown> | null;
      if (!body || typeof body !== "object" || typeof body.type !== "string") {
        return res.sendStatus(204);
      }
      // 2026-08-19 · the in-memory ring buffer (services/conversionEvents)
      // that used to mirror this write was deleted: it duplicated the
      // customer_events insert below, lost its 500 events on every deploy,
      // and its only reader (conversion.recentEvents) now queries the
      // durable table instead.
      // Persist. Best-effort: a dead DB must never turn an analytics
      // beacon into a 500.
      try {
        const { db } = await import("../lib/db-helper");
        const d = await db();
        if (d) {
          const { customerEvents } = await import("../../drizzle/schema");
          const str = (v: unknown, max: number) =>
            typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
          // Datacenter / spoofed-UA / automation beacons are TAGGED, not dropped,
          // so readers can exclude them and the tagging stays auditable. The raw
          // IP is never stored. req.ip is the client (trust proxy, rateLimiters.ts).
          const { classifyTraffic } = await import("../lib/trafficClass");
          const trafficClass = classifyTraffic(req.get("user-agent"), req.ip);
          await d.insert(customerEvents).values({
            eventName: String(body.type).slice(0, 64),
            eventData: {
              source: "conversion_hook",
              traffic: { class: trafficClass },
              ...(typeof body.element === "string" ? { element: body.element.slice(0, 200) } : {}),
              ...(typeof body.value === "number" ? { value: body.value } : {}),
              ...(typeof body.props === "object" && body.props !== null ? { props: body.props } : {}),
            },
            sourcePage: str(body.page, 500),
            utmSource: str(body.utmSource, 100),
            utmMedium: str(body.utmMedium, 100),
            utmCampaign: str(body.utmCampaign, 255),
            referrer: str(body.referrer, 500),
            userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
            sessionId: str(body.sessionId, 64),
          });
        }
      } catch (persistErr) {
        serverLog.warn("[server:conversionEvent] persist failed (ring buffer still has it)", {
          error: persistErr instanceof Error ? persistErr.message : String(persistErr),
        });
      }

      res.sendStatus(204);
    } catch (e) {
      // Conversion analytics never blocks UX — swallow errors.
      serverLog.warn("[server:conversionEvent] failed", { error: e instanceof Error ? e.message : String(e) });
      res.sendStatus(204);
    }
  });

  app.post("/api/track-abandoned", express.json(), async (req, res) => {
    try {
      if (isPrerenderPass()) return res.sendStatus(204);
      const { name, phone, service, vehicle, step: formStep, formType, sessionId: bodySessionId } = req.body || {};
      // wave-147 — was `if (!name && !phone) return sendStatus(204)`,
      // which silently dropped the majority of step-1 abandonment events
      // (users who picked a service + bounced before touching name/phone).
      // Now: keep at least one of {name, phone, service} as the signal of
      // real engagement; only reject totally-empty beacons.
      if (!name && !phone && !service) return res.sendStatus(204);
      const { savePartialForm } = await import("../services/abandonedForms");
      const sessionId = bodySessionId || `beacon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const parsedFormType = (typeof formType === "string" && ["booking", "lead", "callback", "quote", "tire_order"].includes(formType))
        ? (formType as "booking" | "lead" | "callback" | "quote" | "tire_order")
        : "booking";

      savePartialForm({
        sessionId,
        formType: parsedFormType,
        name: typeof name === "string" ? name.slice(0, 200) : undefined,
        phone: typeof phone === "string" ? phone.slice(0, 20) : undefined,
        service: typeof service === "string" ? service.slice(0, 200) : undefined,
        pageUrl: parsedFormType === "tire_order" ? `/tires (step ${formStep || "?"})` : `/book (step ${formStep || "?"})`,
      });
      res.sendStatus(204);
    } catch (e) {
      serverLog.warn("[server:abandonedForm] tracking failed", { error: e instanceof Error ? e.message : String(e) });
      res.sendStatus(204);
    }
  });

  // ─── Uber drop-off code tracking ────────────────────
  // Hits from UberDropoffWidget — records to audit_log so drop-off-ratio
  // bridge endpoint can count Uber-out events.
  app.post("/api/uber-code", express.json({ limit: "2kb" }), async (req, res) => {
    try {
      if (isPrerenderPass()) return res.sendStatus(204);
      const body = req.body as { code?: string };
      if (!body?.code) return res.sendStatus(204);
      const { db } = await import("../lib/db-helper");
      const { auditLog } = await import("../../drizzle/schema");
      const { randomUUID } = await import("crypto");
      const d = await db();
      if (!d) return res.sendStatus(204);
      await d.insert(auditLog).values({
        id: randomUUID(),
        actor: "public",
        action: "customer.uber_requested",
        entityType: "uber_code",
        entityId: body.code.slice(0, 32),
        changes: { code: body.code, userAgent: req.headers["user-agent"]?.toString().slice(0, 200) ?? null },
        ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null,
      });
      res.sendStatus(204);
    } catch {
      res.sendStatus(204);
    }
  });

  // ─── Core Web Vitals telemetry ──────────────────────
  // Receives navigator.sendBeacon from client/src/lib/cwv.ts
  // No auth — it's anonymous metric data. Batched samples per request.
  app.post("/api/cwv", express.json({ limit: "32kb" }), async (req, res) => {
    try {
      const { recordCwvSample } = await import("../lib/cwv-telemetry");
      const body = req.body as { samples?: unknown };
      if (!Array.isArray(body?.samples)) return res.sendStatus(204);
      // Cap per-request to prevent abuse
      for (const s of (body.samples as unknown[]).slice(0, 25)) {
        if (typeof s !== "object" || !s) continue;
        const sample = s as {
          metric?: string; value?: number; route?: string;
          navType?: string; sessionId?: string; timestamp?: number;
        };
        if (!sample.metric || typeof sample.value !== "number") continue;
        recordCwvSample({
          metric: sample.metric as "LCP" | "CLS" | "INP" | "FCP" | "TTFB",
          value: sample.value,
          route: (sample.route || "/").slice(0, 200),
          navType: (sample.navType || "navigate").slice(0, 40),
          sessionId: (sample.sessionId || "anon").slice(0, 80),
          timestamp: sample.timestamp,
        });
      }
      res.sendStatus(204);
    } catch {
      res.sendStatus(204);
    }
  });
}
