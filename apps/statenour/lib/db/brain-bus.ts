/**
 * Brain bus · Phase 2B · v8.4 · Apr 29.
 *
 * Lightweight async event channel built on Postgres LISTEN/NOTIFY
 * (zero new infra — Neon supports it natively). Composes on the v8.0
 * entity-audit + v7.7 idempotency primitives so consumers can react
 * to mutations WITHOUT polling.
 *
 * Skeleton ships:
 *   · `publish(channel, payload)` — fire-and-forget; uses prisma's
 *     existing connection pool via $executeRaw, no new dep needed.
 *     Truncates payload to Postgres's 8000-byte NOTIFY limit.
 *   · `subscribe(channel, onMessage)` — requires the optional `pg`
 *     package because LISTEN holds a connection (incompatible with
 *     pooled clients). Throws a clear install-hint error if `pg`
 *     isn't installed.
 *
 * Use cases lined up:
 *   · brain-cycle cron publishes "memory_stored" → embedding service
 *     consumes and warms the vector cache.
 *   · entity-audit writes can opt-in to "audit_emitted" → Telegram
 *     bot listens for high-severity actor=user mutations.
 *
 * Not yet:
 *   · Multi-tenant channel routing (will compose with tenantId).
 *   · Replay-from-offset (LISTEN is at-most-once; durable consumers
 *     need a ledger table — separate batch).
 */

import { prisma } from "@/lib/prisma";

const NOTIFY_LIMIT = 7800; // Postgres allows 8000 bytes; keep headroom.

export interface BusEnvelope<T = unknown> {
  /** Monotonic-ish id for consumer-side dedup. */
  id: string;
  /** ISO datetime of publish. */
  at: string;
  /** Unbounded payload — caller's responsibility to keep small. */
  payload: T;
}

export function makeBusId(): string {
  const ts = Date.now().toString(36).padStart(10, "0");
  const rnd = Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  return `${ts}-${rnd}`;
}

/**
 * Channel-name sanitizer. Postgres identifiers ≤63 chars and the
 * subscriber matches by exact string. Any character outside
 * [a-z0-9_] is replaced with `_`.
 */
export function sanitizeChannel(channel: string): string {
  return channel
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 60);
}

/**
 * Publish a payload to a channel. Returns the envelope id.
 *
 * Routing through prisma's pool means we don't add a new dep, and
 * NOTIFY survives Neon's connection cycling (notify is fire-and-forget
 * at the pg protocol level).
 */
export async function publish<T>(
  channel: string,
  payload: T,
): Promise<string> {
  const env: BusEnvelope<T> = {
    id: makeBusId(),
    at: new Date().toISOString(),
    payload,
  };
  let serialized = JSON.stringify(env);
  if (serialized.length > NOTIFY_LIMIT) {
    const truncated: BusEnvelope = {
      id: env.id,
      at: env.at,
      payload: { _truncated: true, sizeBytes: serialized.length },
    };
    serialized = JSON.stringify(truncated);
  }
  const safe = sanitizeChannel(channel);
  // pg_notify() is parameterized — no SQL injection surface even
  // though the channel name is interpolated.
  await prisma.$executeRaw`SELECT pg_notify(${safe}, ${serialized})`;
  return env.id;
}

/**
 * Subscribe to a channel. Requires the optional `pg` peer dep.
 *
 * Returns an async unsubscribe function. The skeleton doesn't
 * auto-reconnect — callers are responsible for re-subscribing on
 * connection-error events from their environment.
 */
export async function subscribe<T = unknown>(
  channel: string,
  onMessage: (env: BusEnvelope<T>) => void | Promise<void>,
): Promise<() => Promise<void>> {
  // Dynamic import so the skeleton compiles + ships even when `pg`
  // isn't installed. Use a string-literal-spread + eval-ish import
  // to avoid TS resolving the type — typed any here intentionally.
  const moduleName = "pg";
   
  let pgModule: any;
  try {
     
    pgModule = await (Function(
      "name",
      "return import(name);",
    ) as (name: string) => Promise<unknown>)(moduleName);
  } catch {
    throw new Error(
      "brain-bus.subscribe requires the `pg` package — `pnpm add pg @types/pg`",
    );
  }
  const connectionString =
    process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  if (!connectionString) {
    throw new Error("brain-bus: DATABASE_URL / DIRECT_URL not set");
  }
  const ClientCtor = pgModule.Client ?? pgModule.default?.Client;
  if (!ClientCtor) {
    throw new Error("brain-bus: pg module loaded but Client constructor missing");
  }
   
  const client: any = new ClientCtor({ connectionString });
  await client.connect();

  const safe = sanitizeChannel(channel);
  await client.query(`LISTEN "${safe}"`);

  const handler = (msg: { channel: string; payload?: string }) => {
    if (msg.channel !== safe || !msg.payload) return;
    try {
      const env = JSON.parse(msg.payload) as BusEnvelope<T>;
      void onMessage(env);
    } catch (err) {
      console.warn(`[brain-bus] malformed payload on ${safe}:`, err);
    }
  };
  client.on("notification", handler);

  return async () => {
    try {
      await client.query(`UNLISTEN "${safe}"`);
    } catch {
      /* connection already torn down */
    }
    client.off("notification", handler);
    await client.end();
  };
}
