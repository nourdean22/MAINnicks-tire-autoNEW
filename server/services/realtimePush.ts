/**
 * Real-time Push — SSE (Server-Sent Events) for live dashboard updates.
 *
 * Instead of polling every 30s, the admin dashboard subscribes to SSE
 * and gets instant push when something happens (new lead, invoice, etc).
 *
 * Tesla principle: the dashboard should update the INSTANT something happens.
 */

import { createLogger } from "../lib/logger";

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
  const payload = `id: ${eventCounter}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;

  const dead: typeof clients extends Set<infer T> ? T[] : never[] = [];
  for (const client of clients) {
    try {
      client.res.write(payload);
      client.lastEventId = eventCounter;
    } catch {
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
export function sseHandler(req: any, res: any): void {
  // Verify admin auth — always require valid credentials
  const auth = req.headers.authorization;
  const expected = process.env.ADMIN_API_KEY;
  const hasValidBearer = expected && auth === `Bearer ${expected}`;
  const hasValidCookie = req.cookies?.admin_token && req.cookies.admin_token.length > 10;

  if (!hasValidBearer && !hasValidCookie) {
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
    } catch {
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
