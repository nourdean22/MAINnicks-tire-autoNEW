/**
 * Railway project webhook -> owner page · 2026-09-23.
 *
 * Evidence: the Railway project `natural-appreciation` had ZERO project
 * webhooks (read 2026-09-23), so a FAILED or CRASHED deploy of nickstire.org
 * or bdnick.info paged nobody. This module is the receiver's brain; the route
 * (app/api/webhooks/railway/[token]/route.ts) is a thin shell around it.
 *
 * Railway facts this is built on (docs.railway.com/observability/webhooks,
 * read 2026-09-23):
 *   · payload `{ type: "Deployment.failed", details: { id, status, commitHash,
 *     commitMessage, ... }, resource: { project, environment, service,
 *     deployment: { id } }, severity, timestamp }` — plus volume-usage and
 *     CPU/RAM monitor alert events whose type names are NOT documented;
 *   · deliveries are UNSIGNED — the only authentication is a secret in the
 *     URL, so the path token is the whole auth;
 *   · a non-2xx is retried up to 3 times, and delivery is best-effort and
 *     unordered — so every page is claimed once per (deployment, status)
 *     BEFORE it is sent, or a retry double-pages.
 *
 * Dedupe rides the existing durable claim store (ActionAttempt, a unique
 * operation key + compare-and-swap reclaim — lib/services/action-attempts.ts),
 * not a second table. A page that did not reach Telegram settles FAILED, which
 * frees the key: Railway's retry then gets a second chance to page, and the
 * route answers 502 so that retry happens. If the claim store itself is
 * unreachable the page still goes out, deduped in-process only — a crashed
 * deploy must not be silenced by the database it may have taken down.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { logger as rootLogger } from "@/lib/logger";
import { sendTelegram } from "@/lib/services/telegram";
import { beginAttempt, settleAttempt } from "@/lib/services/action-attempts";

const log = rootLogger.withSurface("webhooks/railway");

/** Shorter than this and the env value is treated as unset: a guessable URL secret is no secret. */
const MIN_TOKEN_LENGTH = 24;

/**
 * Deployment states that page the owner. Everything else (BUILDING, SUCCESS, REMOVED...) is ignored.
 * OOM_KILLED is Railway's `Deployment.oom_killed` event (the Railway MCP webhook enum, 2026-09-23):
 * the service died out of memory, which is an outage exactly like a crash.
 */
const PAGING_DEPLOY_STATES = new Set(["FAILED", "CRASHED", "OOM_KILLED"]);

/** One page per (deployment, status) for this long — a crash-looping deploy pages once, not every restart. */
const DEPLOY_DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Resource (volume / monitor) alerts: identical deliveries inside this window are one page. */
const RESOURCE_DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;

const TOOL = "railway.deploy_alert";

/**
 * The path token against RAILWAY_WEBHOOK_TOKEN. Timing-safe over SHA-256
 * digests so neither the value nor its length leaks. Unset / too short =>
 * false, and the route answers 404: an unconfigured receiver does not exist.
 */
export function verifyRailwayWebhookRequest(supplied: string | undefined | null): boolean {
  const expected = (process.env.RAILWAY_WEBHOOK_TOKEN ?? "").trim();
  if (expected.length < MIN_TOKEN_LENGTH) {
    if (expected) log.warn("railway_webhook_token_too_short", { minLength: MIN_TOKEN_LENGTH });
    return false;
  }
  if (!supplied) return false;
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

type Named = { id?: unknown; name?: unknown; isEphemeral?: unknown };
interface RailwayPayload {
  type?: unknown;
  status?: unknown;
  severity?: unknown;
  timestamp?: unknown;
  details?: Record<string, unknown>;
  resource?: { project?: Named; environment?: Named; service?: Named; deployment?: Named };
  // Legacy (pre-2025) shape: top-level project/environment/service/deployment.
  project?: Named;
  environment?: Named;
  service?: Named;
  deployment?: Named;
}

export type RailwayClassification =
  | { action: "ignore"; reason: string; eventType: string }
  | {
      action: "page";
      kind: "deployment" | "resource_alert";
      eventType: string;
      /** DEPLOYMENT status (FAILED / CRASHED) or the alert's severity. */
      status: string;
      dedupeKey: string;
      windowMs: number;
      deploymentId: string | null;
      message: string;
    };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const UUIDISH = /^[0-9a-f-]{8,64}$/i;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Pure: payload (+ its raw bytes, for resource-alert dedupe) -> page or ignore.
 * Never throws on a hostile body; anything unrecognised is an `ignore` with a reason.
 */
export function classifyRailwayEvent(body: unknown, rawBody: string): RailwayClassification {
  const p = (body && typeof body === "object" ? body : {}) as RailwayPayload;
  const eventType = str(p.type) ?? "unknown";
  const lower = eventType.toLowerCase();
  const r = p.resource ?? {};
  const project = r.project ?? p.project ?? {};
  const env = r.environment ?? p.environment ?? {};
  const service = r.service ?? p.service ?? {};
  const deployment = r.deployment ?? p.deployment ?? {};
  const details = p.details && typeof p.details === "object" ? p.details : {};

  // PR / preview environments are noise, not an outage.
  if (env.isEphemeral === true) return { action: "ignore", reason: "ephemeral_environment", eventType };

  const where = [str(service.name) ?? "unknown service", `${str(project.name) ?? "unknown project"} (${str(env.name) ?? "unknown env"})`];
  const projectId = str(project.id);
  const serviceId = str(service.id);
  const envId = str(env.id);
  const link =
    projectId && serviceId && UUIDISH.test(projectId) && UUIDISH.test(serviceId)
      ? `https://railway.com/project/${projectId}/service/${serviceId}${envId && UUIDISH.test(envId) ? `?environmentId=${envId}` : ""}`
      : null;
  const when = str(p.timestamp) ?? new Date().toISOString();

  const isDeployment = lower.startsWith("deployment.") || lower === "deploy";
  if (isDeployment) {
    const status = (lower.startsWith("deployment.") ? lower.slice("deployment.".length) : str(p.status) ?? str(details.status) ?? "")
      .toUpperCase();
    if (!PAGING_DEPLOY_STATES.has(status)) return { action: "ignore", reason: `deploy_status_${status || "missing"}`, eventType };
    const deploymentId = str(deployment.id) ?? str(details.id);
    const commit = str(details.commitHash)?.slice(0, 7);
    const commitMessage = str(details.commitMessage)?.split("\n")[0].slice(0, 120);
    const lines = [
      `🔴 <b>Railway deploy ${escapeHtml(status)}</b> · ${escapeHtml(where[0])}`,
      escapeHtml(where[1]),
      commit ? `commit <code>${escapeHtml(commit)}</code>${commitMessage ? ` · ${escapeHtml(commitMessage)}` : ""}` : null,
      deploymentId ? `deployment <code>${escapeHtml(deploymentId.slice(0, 64))}</code>` : null,
      escapeHtml(when.slice(0, 40)),
      link,
    ].filter(Boolean);
    return {
      action: "page",
      kind: "deployment",
      eventType,
      status,
      // No deployment id -> the delivery bytes are the identity (a retry resends them unchanged).
      dedupeKey: `railway:deploy:${deploymentId ? deploymentId.slice(0, 80) : `body-${sha(rawBody).slice(0, 32)}`}:${status}`,
      windowMs: DEPLOY_DEDUPE_WINDOW_MS,
      deploymentId,
      message: lines.join("\n"),
    };
  }

  // Volume-usage and CPU/RAM monitor alerts. Railway does not document their
  // type names, so match the family and let the type itself tell the owner.
  if (/volume|monitor|alert|usage|cpu|memory|ram/.test(lower)) {
    if (/(resolved|recovered|cleared|ok)$/.test(lower)) return { action: "ignore", reason: "alert_resolved", eventType };
    const severity = (str(p.severity) ?? "ALERT").toUpperCase();
    const lines = [
      `🟠 <b>Railway ${escapeHtml(eventType.slice(0, 80))}</b> · ${escapeHtml(where[0])}`,
      escapeHtml(where[1]),
      `severity ${escapeHtml(severity.slice(0, 20))}`,
      escapeHtml(when.slice(0, 40)),
      link,
    ].filter(Boolean);
    return {
      action: "page",
      kind: "resource_alert",
      eventType,
      status: severity,
      dedupeKey: `railway:alert:${sha(rawBody).slice(0, 48)}`,
      windowMs: RESOURCE_DEDUPE_WINDOW_MS,
      deploymentId: null,
      message: lines.join("\n"),
    };
  }

  return { action: "ignore", reason: "unhandled_event_type", eventType };
}

// In-process fallback for when the claim store is unreachable. Best-effort only
// (one process, lost on restart) — it exists so a DB outage degrades dedupe, not paging.
const memoryClaims = new Map<string, number>();
function memoryClaim(key: string, windowMs: number, now = Date.now()): boolean {
  for (const [k, until] of memoryClaims) if (until <= now) memoryClaims.delete(k);
  if ((memoryClaims.get(key) ?? 0) > now) return false;
  memoryClaims.set(key, now + windowMs);
  return true;
}
/** Test seam: the in-process fallback outlives a single test otherwise. */
export function __resetRailwayAlertMemory(): void {
  memoryClaims.clear();
}

export type PageOutcome = "sent" | "duplicate" | "undelivered";

/** Claim the page, send it once, settle the claim. Never throws. */
export async function pageOnce(c: Extract<RailwayClassification, { action: "page" }>): Promise<PageOutcome> {
  let attemptId: string | null = null;
  try {
    const begun = await beginAttempt({
      operationKey: c.dedupeKey,
      tool: TOOL,
      argumentsHash: sha(c.dedupeKey),
      effectClass: "write",
      windowMs: c.windowMs,
    });
    if (begun.kind === "duplicate") {
      log.info("railway_page_duplicate", { eventType: c.eventType, status: c.status, deploymentId: c.deploymentId, priorState: begun.state });
      return "duplicate";
    }
    attemptId = begun.attemptId;
  } catch (error) {
    // Claim store down / table missing: page anyway, dedupe in-process.
    log.warn("railway_claim_store_unavailable", { error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    if (!memoryClaim(c.dedupeKey, c.windowMs)) return "duplicate";
  }

  const delivered = await sendTelegram(c.message).catch(() => false);

  if (attemptId) {
    await settleAttempt(attemptId, delivered ? { disposition: "success" } : { disposition: "known_failure", reason: "sendTelegram returned false" }).catch(
      (error) => log.error("railway_claim_settle_failed", { error: error instanceof Error ? error.message.slice(0, 200) : String(error) }),
    );
  } else if (!delivered) {
    memoryClaims.delete(c.dedupeKey); // let Railway's retry try again
  }

  if (!delivered) {
    log.error("railway_page_undelivered", { eventType: c.eventType, status: c.status, deploymentId: c.deploymentId });
    return "undelivered";
  }
  log.info("railway_page_sent", { eventType: c.eventType, status: c.status, deploymentId: c.deploymentId });
  return "sent";
}
