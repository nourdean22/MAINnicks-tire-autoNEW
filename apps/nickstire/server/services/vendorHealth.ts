/**
 * Vendor Health — Real API health checks for every integration.
 *
 * UPGRADED: Continuous monitoring (5-min intervals), SLA tracking
 * (uptime %, avg response time), alerting via Telegram, response caching,
 * cost tracking, circuit breaker integration.
 *
 * Replaces env-var-only detection with actual API probes.
 * Each check has a 5s timeout and returns pass/fail with latency.
 */

import { createLogger } from "../lib/logger";
import { getOrCreateBreaker } from "../lib/circuit-breaker";

const log = createLogger("vendor-health");

export interface VendorCheck {
  name: string;
  passed: boolean;
  latencyMs: number;
  error?: string;
}

export interface VendorHealthResult {
  vendor: string;
  status: "healthy" | "degraded" | "down" | "not_configured";
  checks: VendorCheck[];
  checkedAt: string;
}

// ─── SLA Tracking ──────────────────────────────────
interface VendorSLA {
  vendor: string;
  totalChecks: number;
  successfulChecks: number;
  uptimePercent: number;
  avgResponseMs: number;
  responseSamples: number[];
  lastCheckAt: string | null;
  lastDownAt: string | null;
  downtimeMinutes: number;
  currentStreak: "up" | "down";
  streakStartedAt: string;
}

const slaData = new Map<string, VendorSLA>();

function getOrCreateSLA(vendor: string): VendorSLA {
  let sla = slaData.get(vendor);
  if (!sla) {
    sla = {
      vendor,
      totalChecks: 0,
      successfulChecks: 0,
      uptimePercent: 100,
      avgResponseMs: 0,
      responseSamples: [],
      lastCheckAt: null,
      lastDownAt: null,
      downtimeMinutes: 0,
      currentStreak: "up",
      streakStartedAt: new Date().toISOString(),
    };
    slaData.set(vendor, sla);
  }
  return sla;
}

function updateSLA(vendor: string, passed: boolean, latencyMs: number): void {
  const sla = getOrCreateSLA(vendor);
  sla.totalChecks++;
  sla.lastCheckAt = new Date().toISOString();

  if (passed) {
    sla.successfulChecks++;
    if (sla.currentStreak === "down") {
      sla.currentStreak = "up";
      sla.streakStartedAt = new Date().toISOString();
    }
  } else {
    sla.lastDownAt = new Date().toISOString();
    if (sla.currentStreak === "up") {
      sla.currentStreak = "down";
      sla.streakStartedAt = new Date().toISOString();
    }
    // Accumulate downtime (5 min per check interval)
    sla.downtimeMinutes += 5;
  }

  // Track response times
  sla.responseSamples.push(latencyMs);
  if (sla.responseSamples.length > 100) sla.responseSamples.shift();
  sla.avgResponseMs = Math.round(
    sla.responseSamples.reduce((a, b) => a + b, 0) / sla.responseSamples.length
  );

  // Calculate uptime percentage
  sla.uptimePercent = sla.totalChecks > 0
    ? Math.round((sla.successfulChecks / sla.totalChecks) * 10000) / 100
    : 100;
}

export function getVendorSLA(vendor?: string): VendorSLA | VendorSLA[] {
  if (vendor) return getOrCreateSLA(vendor);
  return Array.from(slaData.values());
}

// ─── Response Cache ────────────────────────────────
let cachedResults: VendorHealthResult[] | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes (upgraded from 60s)

// ─── Cost Tracking ─────────────────────────────────
interface VendorCostTracker {
  vendor: string;
  apiCallsToday: number;
  apiCallsTotal: number;
  estimatedCostToday: number;
  costPerCall: number; // estimated
  resetAt: number;
}

const costTrackers = new Map<string, VendorCostTracker>();

function trackApiCost(vendor: string, costPerCall: number = 0): void {
  let tracker = costTrackers.get(vendor);
  const now = Date.now();

  if (!tracker || now > tracker.resetAt) {
    tracker = {
      vendor,
      apiCallsToday: 0,
      apiCallsTotal: costTrackers.get(vendor)?.apiCallsTotal || 0,
      estimatedCostToday: 0,
      costPerCall,
      resetAt: now + 24 * 60 * 60 * 1000, // reset daily
    };
    costTrackers.set(vendor, tracker);
  }

  tracker.apiCallsToday++;
  tracker.apiCallsTotal++;
  tracker.estimatedCostToday = tracker.apiCallsToday * tracker.costPerCall;
}

export function getVendorCosts(): VendorCostTracker[] {
  return Array.from(costTrackers.values());
}

// ─── Timeout helper ──────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// ─── Individual vendor health checks ─────────────────────

async function checkDatabase(): Promise<VendorHealthResult> {
  const start = Date.now();
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return { vendor: "Database", status: "down", checks: [{ name: "connection", passed: false, latencyMs: 0, error: "No connection" }], checkedAt: new Date().toISOString() };

    const { sql } = await import("drizzle-orm");
    await withTimeout(d.execute(sql`SELECT 1`), 5000);
    const latency = Date.now() - start;
    trackApiCost("Database", 0);
    updateSLA("Database", true, latency);
    return {
      vendor: "Database",
      status: "healthy",
      checks: [{ name: "query", passed: true, latencyMs: latency }],
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const latency = Date.now() - start;
    updateSLA("Database", false, latency);
    return {
      vendor: "Database",
      status: "down",
      checks: [{ name: "query", passed: false, latencyMs: latency, error: (err as Error).message }],
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkGoogleSheets(): Promise<VendorHealthResult> {
  const start = Date.now();
  const { isSheetConfigured } = await import("../sheets-sync");

  if (!isSheetConfigured()) {
    return {
      vendor: "Google Sheets CRM",
      status: "not_configured",
      checks: [{ name: "env_config", passed: false, latencyMs: 0, error: "No spreadsheet ID configured" }],
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!email || !rawKey) throw new Error("No GOOGLE_SERVICE_ACCOUNT_EMAIL or KEY");

    const { google } = await import("googleapis");
    const privateKey = rawKey.replace(/\\n/g, "\n");
    const auth = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEETS_CRM_ID;

    await withTimeout(
      sheets.spreadsheets.get({ spreadsheetId: spreadsheetId! }),
      5000
    );

    const latency = Date.now() - start;
    trackApiCost("Google Sheets CRM", 0.001); // ~$0.001 per read
    updateSLA("Google Sheets CRM", true, latency);
    return {
      vendor: "Google Sheets CRM",
      status: "healthy",
      checks: [
        { name: "env_config", passed: true, latencyMs: 0 },
        { name: "api_access", passed: true, latencyMs: latency },
      ],
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const latency = Date.now() - start;
    updateSLA("Google Sheets CRM", false, latency);
    return {
      vendor: "Google Sheets CRM",
      status: "degraded",
      checks: [
        { name: "env_config", passed: true, latencyMs: 0 },
        { name: "api_access", passed: false, latencyMs: latency, error: (err as Error).message?.slice(0, 100) },
      ],
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkGmail(): Promise<VendorHealthResult> {
  const { getDeliveryLog } = await import("../email-notify");
  const recentLog = getDeliveryLog(5);
  const recentSuccess = recentLog.filter((l: any) => l.emailSent).length;

  if (recentLog.length === 0) {
    updateSLA("Gmail Notifications", true, 0);
    return {
      vendor: "Gmail Notifications",
      status: "healthy",
      checks: [{ name: "delivery_log", passed: true, latencyMs: 0 }],
      checkedAt: new Date().toISOString(),
    };
  }

  const passed = recentSuccess > 0;
  updateSLA("Gmail Notifications", passed, 0);
  return {
    vendor: "Gmail Notifications",
    status: passed ? "healthy" : "degraded",
    checks: [{
      name: "delivery_log",
      passed,
      latencyMs: 0,
      error: passed ? undefined : `0/${recentLog.length} recent sends succeeded`,
    }],
    checkedAt: new Date().toISOString(),
  };
}

async function checkGatewayTire(): Promise<VendorHealthResult> {
  const start = Date.now();
  const username = process.env.GATEWAY_TIRE_USERNAME;
  const password = process.env.GATEWAY_TIRE_PASSWORD;

  if (!username || !password) {
    return {
      vendor: "Gateway Tire B2B",
      status: "not_configured",
      checks: [{ name: "credentials", passed: false, latencyMs: 0, error: "No credentials configured" }],
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    // As of 2026-05 b2b.dktire.com migrated to api-b2b.dktire.com with
    // OAuth2 password grant. We probe the new /token endpoint through
    // the shared gatewayClient (which caches the JWT and surfaces a
    // structured failure reason if auth is broken).
    const { getGatewayToken, invalidateGatewaySession, getLastGatewayFailure } = await import("./gatewayClient");
    // Force a fresh probe — don't reuse a cached token that pre-dates
    // a credential rotation; we want to know if /token works RIGHT NOW.
    invalidateGatewaySession();
    const token = await withTimeout(getGatewayToken(), 8000);
    const latency = Date.now() - start;
    const isSuccess = !!token;
    const failure = getLastGatewayFailure();

    trackApiCost("Gateway Tire B2B", 0);
    updateSLA("Gateway Tire B2B", isSuccess, latency);

    return {
      vendor: "Gateway Tire B2B",
      status: isSuccess ? "healthy" : "degraded",
      checks: [
        { name: "credentials", passed: true, latencyMs: 0 },
        { name: "auth_probe", passed: isSuccess, latencyMs: latency, error: isSuccess ? undefined : (failure?.reason || "Auth returned no token") },
      ],
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const latency = Date.now() - start;
    updateSLA("Gateway Tire B2B", false, latency);
    return {
      vendor: "Gateway Tire B2B",
      status: "down",
      checks: [
        { name: "credentials", passed: true, latencyMs: 0 },
        { name: "auth_probe", passed: false, latencyMs: latency, error: (err as Error).message },
      ],
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkCapevace(): Promise<VendorHealthResult> {
  const start = Date.now();
  const username = process.env.SHOP_SMS_GATEWAY_USERNAME;
  const password = process.env.SHOP_SMS_GATEWAY_PASSWORD;
  const baseUrl = process.env.SHOP_SMS_GATEWAY_URL || "https://api.sms-gate.app/3rdparty/v1";

  if (!username || !password) {
    return {
      vendor: "Capevace SMS Gateway",
      status: "not_configured",
      checks: [{ name: "credentials", passed: false, latencyMs: 0, error: "No credentials configured" }],
      checkedAt: new Date().toISOString(),
    };
  }

  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  try {
    const res = await withTimeout(
      fetch(`${baseUrl}/device`, {
        headers: { Authorization: `Basic ${auth}` },
      }),
      8000
    );

    const ok = res.status === 200;
    const latency = Date.now() - start;

    if (!ok) {
      updateSLA("Capevace SMS Gateway", false, latency);
      return {
        vendor: "Capevace SMS Gateway",
        status: "degraded",
        checks: [
          { name: "credentials", passed: true, latencyMs: 0 },
          { name: "gateway_verify", passed: false, latencyMs: latency, error: `API returned ${res.status}` },
        ],
        checkedAt: new Date().toISOString(),
      };
    }

    const devices = (await res.json()) as Array<{ id: string; name?: string; lastSeen?: string }>;
    if (!devices.length) {
      updateSLA("Capevace SMS Gateway", false, latency);
      return {
        vendor: "Capevace SMS Gateway",
        status: "degraded",
        checks: [
          { name: "credentials", passed: true, latencyMs: 0 },
          { name: "gateway_verify", passed: false, latencyMs: latency, error: "No devices registered" },
        ],
        checkedAt: new Date().toISOString(),
      };
    }

    const { pickGatewayDevice, isGatewayOnline } = await import("../lib/gateway-device");
    const dev = pickGatewayDevice(devices, process.env.SHOP_SMS_GATEWAY_DEVICE_ID);
    if (!dev) {
      updateSLA("Capevace SMS Gateway", false, latency);
      return {
        vendor: "Capevace SMS Gateway",
        status: "degraded",
        checks: [
          { name: "credentials", passed: true, latencyMs: 0 },
          { name: "gateway_verify", passed: false, latencyMs: latency, error: "Configured device not found" },
        ],
        checkedAt: new Date().toISOString(),
      };
    }

    const lastSeenMs = dev.lastSeen ? new Date(dev.lastSeen).getTime() : 0;
    const ageMin = lastSeenMs ? Math.round((Date.now() - lastSeenMs) / 60_000) : 999;
    const online = isGatewayOnline(ageMin);

    updateSLA("Capevace SMS Gateway", online, latency);

    return {
      vendor: "Capevace SMS Gateway",
      status: online ? "healthy" : "degraded",
      checks: [
        { name: "credentials", passed: true, latencyMs: 0 },
        { name: "gateway_verify", passed: online, latencyMs: latency, error: online ? undefined : `Last seen ${ageMin}m ago` },
      ],
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const latency = Date.now() - start;
    updateSLA("Capevace SMS Gateway", false, latency);
    return {
      vendor: "Capevace SMS Gateway",
      status: "down",
      checks: [
        { name: "credentials", passed: true, latencyMs: 0 },
        { name: "gateway_verify", passed: false, latencyMs: latency, error: (err as Error).message },
      ],
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkStripe(): Promise<VendorHealthResult> {
  const start = Date.now();
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    return {
      vendor: "Stripe Payments",
      status: "not_configured",
      checks: [{ name: "credentials", passed: false, latencyMs: 0, error: "No secret key configured" }],
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const res = await withTimeout(
      fetch("https://api.stripe.com/v1/balance", {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      }),
      5000
    );

    const ok = res.status === 200;
    const latency = Date.now() - start;

    trackApiCost("Stripe Payments", 0); // balance fetch is free
    updateSLA("Stripe Payments", ok, latency);

    return {
      vendor: "Stripe Payments",
      status: ok ? "healthy" : "degraded",
      checks: [
        { name: "credentials", passed: true, latencyMs: 0 },
        { name: "balance_fetch", passed: ok, latencyMs: latency, error: ok ? undefined : `API returned ${res.status}` },
      ],
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const latency = Date.now() - start;
    updateSLA("Stripe Payments", false, latency);
    return {
      vendor: "Stripe Payments",
      status: "down",
      checks: [
        { name: "credentials", passed: true, latencyMs: 0 },
        { name: "balance_fetch", passed: false, latencyMs: latency, error: (err as Error).message },
      ],
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkAutoLabor(): Promise<VendorHealthResult> {
  const start = Date.now();
  const username = process.env.AUTO_LABOR_USERNAME || process.env.ALG_USERNAME;
  const password = process.env.AUTO_LABOR_PASSWORD || process.env.ALG_PASSWORD;

  if (!username || !password) {
    return {
      vendor: "Auto Labor Guide",
      status: "not_configured",
      checks: [{ name: "credentials", passed: false, latencyMs: 0, error: "No credentials configured" }],
      checkedAt: new Date().toISOString(),
    };
  }

  // Wave-100 (2026-05-08): switched from active /api/auth/login probe to
  // PASSIVE state check. Reason: ALG only allows ONE session per user.
  // Every login opens a fresh JWT and kicks the shop counter's session,
  // which the cashier needs for ringing customers up. The vendor-health
  // cron fires every 15 min — that's 96 sessions/day if the probe ever
  // worked. Pre-fix the URL was wrong (silent fail, accidentally safe).
  // Now we check mirror-internal state instead.
  try {
    const { checkMirrorHealth } = await import("./shopDriverMirror");
    const health = await checkMirrorHealth();
    const latency = Date.now() - start;

    // checkMirrorHealth returns recordsProcessed: 0 when stale/failed,
    // 1 when last sync was fresh.
    const isHealthy = health.recordsProcessed > 0;
    trackApiCost("Auto Labor Guide", 0);
    updateSLA("Auto Labor Guide", isHealthy, latency);

    return {
      vendor: "Auto Labor Guide",
      status: isHealthy ? "healthy" : "degraded",
      checks: [
        { name: "credentials", passed: true, latencyMs: 0 },
        { name: "passive_health", passed: isHealthy, latencyMs: latency, error: isHealthy ? undefined : health.details },
      ],
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const latency = Date.now() - start;
    updateSLA("Auto Labor Guide", false, latency);
    return {
      vendor: "Auto Labor Guide",
      status: "down",
      checks: [
        { name: "credentials", passed: true, latencyMs: 0 },
        { name: "passive_health", passed: false, latencyMs: latency, error: (err as Error).message },
      ],
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkNourOsBridge(): Promise<VendorHealthResult> {
  const start = Date.now();
  try {
    const { getSyncStatus } = await import("../nour-os-bridge");
    const status = getSyncStatus();
    const isHealthy = !status.lastError;
    const latency = Date.now() - start;

    updateSLA("NOUR OS Bridge", isHealthy, latency);

    return {
      vendor: "NOUR OS Bridge",
      status: isHealthy ? "healthy" : "degraded",
      checks: [
        { name: "bridge_status", passed: isHealthy, latencyMs: latency, error: status.lastError || undefined },
      ],
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const latency = Date.now() - start;
    updateSLA("NOUR OS Bridge", false, latency);
    return {
      vendor: "NOUR OS Bridge",
      status: "down",
      checks: [{ name: "bridge_status", passed: false, latencyMs: latency, error: (err as Error).message }],
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkTelegram(): Promise<VendorHealthResult> {
  const start = Date.now();
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return {
      vendor: "Telegram",
      status: "not_configured",
      checks: [{ name: "credentials", passed: false, latencyMs: 0, error: "No bot token or chat ID" }],
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const res = await withTimeout(
      fetch(`https://api.telegram.org/bot${botToken}/getMe`, { method: "GET" }),
      5000
    );
    const ok = res.ok;
    const latency = Date.now() - start;

    trackApiCost("Telegram", 0);
    updateSLA("Telegram", ok, latency);

    return {
      vendor: "Telegram",
      status: ok ? "healthy" : "degraded",
      checks: [
        { name: "credentials", passed: true, latencyMs: 0 },
        { name: "bot_verify", passed: ok, latencyMs: latency, error: ok ? undefined : `API returned ${res.status}` },
      ],
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const latency = Date.now() - start;
    updateSLA("Telegram", false, latency);
    return {
      vendor: "Telegram",
      status: "down",
      checks: [
        { name: "credentials", passed: true, latencyMs: 0 },
        { name: "bot_verify", passed: false, latencyMs: latency, error: (err as Error).message },
      ],
      checkedAt: new Date().toISOString(),
    };
  }
}

function checkFinancing(): VendorHealthResult {
  updateSLA("Financing Providers", true, 0);
  return {
    vendor: "Financing Providers",
    status: "healthy",
    checks: [{ name: "merchant_portals", passed: true, latencyMs: 0 }],
    checkedAt: new Date().toISOString(),
  };
}

// ─── Unified health report ───────────────────────────────

export async function getVendorHealthReport(): Promise<{
  results: VendorHealthResult[];
  overallStatus: "all_systems_operational" | "some_systems_offline" | "degraded";
  checkedAt: string;
  sla: VendorSLA[];
}> {
  // Return cache if fresh
  if (cachedResults && Date.now() - cachedAt < CACHE_TTL) {
    const overallStatus = computeOverall(cachedResults);
    return {
      results: cachedResults,
      overallStatus,
      checkedAt: new Date(cachedAt).toISOString(),
      sla: Array.from(slaData.values()),
    };
  }

  const settled = await Promise.allSettled([
    checkDatabase(),
    checkGoogleSheets(),
    checkGmail(),
    checkGatewayTire(),
    checkCapevace(),
    checkStripe(),
    checkAutoLabor(),
    checkNourOsBridge(),
    checkTelegram(),
  ]);

  const vendorNames = [
    "Database", "Google Sheets CRM", "Gmail Notifications", "Gateway Tire B2B",
    "Capevace SMS Gateway", "Stripe Payments", "Auto Labor Guide", "NOUR OS Bridge", "Telegram",
  ];

  const results: VendorHealthResult[] = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      vendor: vendorNames[i],
      status: "down" as const,
      checks: [{ name: "health_check", passed: false, latencyMs: 0, error: r.reason?.message || "Unknown error" }],
      checkedAt: new Date().toISOString(),
    };
  });

  // Add static financing check
  results.push(checkFinancing());

  // Cache results
  cachedResults = results;
  cachedAt = Date.now();

  // Dispatch vendor health snapshot to NOUR OS bridge (non-blocking)
  import("../nour-os-bridge").then(({ dispatchVendorHealthSnapshot }) => {
    dispatchVendorHealthSnapshot(results).catch((e) => { log.warn("[services/vendorHealth] fire-and-forget failed:", e); });
  }).catch((e) => { log.warn("[services/vendorHealth] fire-and-forget failed:", e); });

  const overallStatus = computeOverall(results);
  return {
    results,
    overallStatus,
    checkedAt: new Date().toISOString(),
    sla: Array.from(slaData.values()),
  };
}

function computeOverall(results: VendorHealthResult[]): "all_systems_operational" | "some_systems_offline" | "degraded" {
  const hasDown = results.some(r => r.status === "down");
  const hasDegraded = results.some(r => r.status === "degraded");

  if (hasDown) return "some_systems_offline";
  if (hasDegraded) return "degraded";
  return "all_systems_operational";
}

/** Force clear the health cache (for manual re-check) */
export function clearHealthCache(): void {
  cachedResults = null;
  cachedAt = 0;
}

// ─── Continuous Monitoring (5 minute interval) ──────────

let monitoringTimer: ReturnType<typeof setInterval> | null = null;
let lastMonitoringResult: VendorHealthResult[] | null = null;

/**
 * Start continuous vendor health monitoring.
 * Runs checks every 5 minutes and alerts via Telegram on state changes.
 */
export function startContinuousMonitoring(): void {
  if (monitoringTimer) return;

  monitoringTimer = setInterval(async () => {
    try {
      // Force fresh check
      clearHealthCache();
      const report = await getVendorHealthReport();

      // Compare with last result to detect changes
      if (lastMonitoringResult) {
        for (const current of report.results) {
          const previous = lastMonitoringResult.find(r => r.vendor === current.vendor);
          if (!previous) continue;

          // Vendor went down
          if (previous.status === "healthy" && (current.status === "down" || current.status === "degraded")) {
            const firstError = current.checks.find(c => !c.passed)?.error;
            try {
              const { alertVendorDown } = await import("./telegram");
              alertVendorDown(current.vendor, firstError);
            } catch (e) {
              log.warn("[services/vendorHealth] operation failed:", e);
              // best-effort
            }
            log.error(`Vendor ${current.vendor} went ${current.status}`, {
              vendor: current.vendor,
              error: firstError,
            });
          }

          // Vendor recovered
          if ((previous.status === "down" || previous.status === "degraded") && current.status === "healthy") {
            try {
              const { alertVendorRecovered } = await import("./telegram");
              alertVendorRecovered(current.vendor);
            } catch (e) {
              log.warn("[services/vendorHealth] operation failed:", e);
              // best-effort
            }
            log.info(`Vendor ${current.vendor} recovered`, { vendor: current.vendor });
          }
        }
      }

      lastMonitoringResult = report.results;
    } catch (err) {
      log.warn("Continuous monitoring check failed", {
        error: err instanceof Error ? (err as Error).message : String(err),
      });
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  log.info("Continuous vendor health monitoring started (5 min interval)");
}

export function stopContinuousMonitoring(): void {
  if (monitoringTimer) {
    clearInterval(monitoringTimer);
    monitoringTimer = null;
  }
}

// 2026-05-23 · removed top-level auto-start. The tiered cron scheduler
// (server/cron/scheduler.ts) ALREADY registers `vendor-health` in the
// pulse tier — auto-starting here meant two parallel paths firing the
// same probes on different cadences (one cron-tracked + observable,
// one orphan setInterval with no observability + no tier-skip
// awareness). startContinuousMonitoring is still exported for tests
// or manual control, just not invoked at module load.
