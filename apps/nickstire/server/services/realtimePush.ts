/**
 * Real-time Push — SSE (Server-Sent Events) for live dashboard updates.
 *
 * Instead of polling every 30s, the admin dashboard subscribes to SSE
 * and gets instant push when something happens (new lead, invoice, etc).
 *
 * Tesla principle: the dashboard should update the INSTANT something happens.
 */

import { createLogger } from "../lib/logger";
import { sdk } from "../_core/sdk";

const log = createLogger("realtime");

// Connected SSE clients
const clients = new Set<{
  res: any;
  lastEventId: number;
}>();

let eventCounter = 0;

/**
 * Push an event to all connected admin dashboards.
 */
export function pushToAdminDashboards(event: {
  type: string;
  data: Record<string, any>;
}): void {
  eventCounter++;
  // 2026-05-23 · guard against circular references / non-serializable
  // values in event.data (Date proxies, class instances, etc.). Pre-fix
  // a single producer dropping a circular object killed the JSON.stringify
  // call and skipped THIS event for ALL connected dashboards silently.
  // Now we fall back to a sanitized payload + log the offender.
  let dataStr: string;
  try {
    dataStr = JSON.stringify(event.data);
  } catch (err) {
    log.warn(`[realtimePush] non-serializable payload for event ${event.type}:`, err instanceof Error ? err.message : err);
    dataStr = JSON.stringify({
      _sanitized: true,
      type: event.type,
      keys: Object.keys(event.data ?? {}),
    });
  }
  const payload = `id: ${eventCounter}\nevent: ${event.type}\ndata: ${dataStr}\n\n`;

  const dead: typeof clients extends Set<infer T> ? T[] : never[] = [];
  for (const client of clients) {
    try {
      client.res.write(payload);
      client.lastEventId = eventCounter;
    } catch (e) {
      log.warn("[services/realtimePush] operation failed:", e);
      dead.push(client as any);
    }
  }

  // Clean up dead connections
  for (const d of dead) clients.delete(d);

  if (clients.size > 0) {
    log.info(`Pushed ${event.type} to ${clients.size} dashboards`);
  }
}

/**
 * Express handler for SSE subscription.
 * Mount at: app.get("/api/admin/events", sseHandler)
 */
export async function sseHandler(req: any, res: any): Promise<void> {
  // Admin auth. The browser transport (EventSource) CANNOT send an
  // Authorization header, so accept the OAuth session cookie the admin
  // already holds — resolved the SAME way as every tRPC adminProcedure
  // (sdk.authenticateRequest → role === "admin"). Keep the ADMIN_API_KEY
  // Bearer as a server-to-server / curl fallback.
  // Pre-fix this required a Bearer header OR a never-set `admin_token` cookie,
  // so every browser EventSource connection 401'd — and the reconnect storm
  // then tripped the clients.size>=50 503 cap.
  const auth = req.headers.authorization;
  const expected = process.env.ADMIN_API_KEY;
  const hasValidBearer = !!expected && auth === `Bearer ${expected}`;

  let isAdmin = false;
  if (!hasValidBearer) {
    try {
      const user = await sdk.authenticateRequest(req);
      isAdmin = user?.role === "admin";
    } catch {
      isAdmin = false;
    }
  }

  if (!hasValidBearer && !isAdmin) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Cap max connections
  if (clients.size >= 50) {
    res.status(503).json({ error: "Too many SSE connections" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send initial heartbeat
  res.write(`data: {"type":"connected","clients":${clients.size + 1}}\n\n`);

  const client = { res, lastEventId: eventCounter };
  clients.add(client);

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch (e) {
      log.warn("[services/realtimePush] operation failed:", e);
      clearInterval(heartbeat);
      clients.delete(client);
    }
  }, 30_000);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
}

/**
 * Get current connection count.
 */
export function getRealtimeStatus(): { connectedClients: number; totalEventsPushed: number } {
  return { connectedClients: clients.size, totalEventsPushed: eventCounter };
}
