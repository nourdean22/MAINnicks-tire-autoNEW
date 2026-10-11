/**
 * The social publish queue's scoped key (operator-authorized 2026-10-10).
 *
 * Any holder of STATENOUR_SYNC_KEY (nickstire's server AND the worker) could create a pending
 * draft through /api/sync/events and publish it publicly through /api/sync/queue in two
 * requests. STATENOUR_QUEUE_KEY is held by nickstire's Command Queue only. Rollout without a
 * broken window: set the queue key on both services (both keys work), then set
 * STATENOUR_QUEUE_KEY_STRICT=1 on statenour-web so the bridge key stops opening the queue.
 */
import { describe, it, expect, vi } from "vitest";
import { queueDoorAccepts } from "@/lib/security/queue-auth";

// auth-guard imports next-auth; load the REAL guard with @/auth stubbed (same as tests/redteam/route-auth).
vi.mock("@/auth", () => ({ auth: () => null, authEnabled: true, signIn: vi.fn(), handlers: {} }));

const QUEUE = "q-key-0123456789abcdef";
const BRIDGE = "bridge-key-0123456789";

describe("queueDoorAccepts", () => {
  it("accepts the scoped queue key", () => {
    expect(queueDoorAccepts(QUEUE, { STATENOUR_QUEUE_KEY: QUEUE, STATENOUR_SYNC_KEY: BRIDGE })).toBe("queue");
  });

  it("transition: the bridge key still opens the queue until strict is set", () => {
    expect(queueDoorAccepts(BRIDGE, { STATENOUR_QUEUE_KEY: QUEUE, STATENOUR_SYNC_KEY: BRIDGE })).toBe("bridge");
    expect(queueDoorAccepts(BRIDGE, { STATENOUR_SYNC_KEY: BRIDGE })).toBe("bridge");
  });

  it("strict: the bridge key no longer opens the queue", () => {
    const env = { STATENOUR_QUEUE_KEY: QUEUE, STATENOUR_SYNC_KEY: BRIDGE, STATENOUR_QUEUE_KEY_STRICT: "1" };
    expect(queueDoorAccepts(BRIDGE, env)).toBeNull();
    expect(queueDoorAccepts(QUEUE, env)).toBe("queue");
  });

  it("strict without a queue key configured opens nothing (fail closed)", () => {
    expect(queueDoorAccepts(BRIDGE, { STATENOUR_SYNC_KEY: BRIDGE, STATENOUR_QUEUE_KEY_STRICT: "1" })).toBeNull();
  });

  it("only the exact value 1 turns strict on", () => {
    const env = { STATENOUR_QUEUE_KEY: QUEUE, STATENOUR_SYNC_KEY: BRIDGE };
    expect(queueDoorAccepts(BRIDGE, { ...env, STATENOUR_QUEUE_KEY_STRICT: " 1 " })).toBeNull();
    expect(queueDoorAccepts(BRIDGE, { ...env, STATENOUR_QUEUE_KEY_STRICT: "0" })).toBe("bridge");
  });

  it("never authenticates an empty, missing or near-miss key", () => {
    const env = { STATENOUR_QUEUE_KEY: QUEUE, STATENOUR_SYNC_KEY: BRIDGE };
    for (const k of ["", " ", QUEUE + "x", QUEUE.slice(0, -1), QUEUE.toUpperCase(), `Bearer ${QUEUE}`]) {
      expect(queueDoorAccepts(k, env)).toBeNull();
    }
    expect(queueDoorAccepts(QUEUE, {})).toBeNull();
    expect(queueDoorAccepts("", { STATENOUR_QUEUE_KEY: "", STATENOUR_SYNC_KEY: "" })).toBeNull();
  });
});

describe("requireQueueAuth (the real guard, not the suite-wide mock)", () => {
  const ENV = ["STATENOUR_QUEUE_KEY", "STATENOUR_SYNC_KEY", "STATENOUR_QUEUE_KEY_STRICT"] as const;
  const call = async (headers: Record<string, string>, env: Partial<Record<(typeof ENV)[number], string>>) => {
    const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    for (const k of ENV) delete process.env[k];
    Object.assign(process.env, env);
    try {
      const real = await vi.importActual<typeof import("@/lib/auth-guard")>("@/lib/auth-guard");
      real.requireQueueAuth(new Request("http://x/api/sync/queue", { headers }));
      return "allowed";
    } catch (e) {
      return (e as { status?: number }).status === 401 ? "401" : `threw ${String(e)}`;
    } finally {
      for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  };
  const strict = { STATENOUR_QUEUE_KEY: QUEUE, STATENOUR_SYNC_KEY: BRIDGE, STATENOUR_QUEUE_KEY_STRICT: "1" };

  it("strict: the bridge key is refused in both header spellings", async () => {
    expect(await call({ "x-sync-key": BRIDGE }, strict)).toBe("401");
    expect(await call({ authorization: `Bearer ${BRIDGE}` }, strict)).toBe("401");
  });

  it("strict: the queue key is allowed in both header spellings", async () => {
    expect(await call({ "x-sync-key": QUEUE }, strict)).toBe("allowed");
    expect(await call({ authorization: `Bearer ${QUEUE}` }, strict)).toBe("allowed");
  });

  it("no header is refused", async () => {
    expect(await call({}, strict)).toBe("401");
  });
});
