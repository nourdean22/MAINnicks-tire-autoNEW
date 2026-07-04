/**
 * call-end ack ordering — speed-to-ack contract (2026-07-04).
 *
 * Before this contract the end-of-call branch did DB connect + inserts +
 * selects BEFORE res.json, so a slow TiDB connect pushed the ack past
 * VAPI's webhook timeout and triggered retries (dup-key noise on
 * vapi_call_logs, double work). These tests pin the new contract through
 * the REAL express route (bare http server):
 *
 *   1. The HTTP ack resolves while the DB layer is still parked on a
 *      gate — post-call work is detached, never awaited by the handler.
 *   2. The ack shape stays the shipped `200 {ack:true}` (VAPI just needs
 *      a 2xx; changing the contract buys nothing).
 *   3. Unknown event types still ack (default branch stays intact).
 *
 * A regression (someone re-inlining an await before res.json) makes the
 * request hang on the gate and test 1 fails by timeout.
 *
 * singleFork hygiene (the full suite runs single-process on Windows —
 * see AGENTS.md): the HTTP client is node:http, NOT global fetch —
 * other test files stub globalThis.fetch and globals leak across files
 * in singleFork. Env is saved/restored, and afterAll drains the
 * detached post-call work so nothing bleeds into the next test file.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Deferred "DB connect": getDb parks on this gate until afterAll releases
// it. If the route awaited the persist path, the request below would hang
// past its timeout instead of resolving instantly.
const dbGate = vi.hoisted(() => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return { gate, release: () => release(), opened: false };
});

vi.mock("../../db", () => ({
  getDb: async () => {
    await dbGate.gate;
    dbGate.opened = true;
    return null; // null db → every persist/dispatch path no-ops safely
  },
}));

// State tracker: inert — its own fire-and-forget wiring is not under test.
vi.mock("../../services/voice-call-state", () => ({
  recordCallState: vi.fn(async () => {}),
  classifyToolToState: () => null,
  getCallStateHistory: vi.fn(async () => []),
}));

import { vapiWebhookRouter } from "./vapi";

let server: http.Server;
let port: number;
let savedSecret: string | undefined;

beforeAll(async () => {
  // Dev-mode signature path (no secret → allow outside production).
  savedSecret = process.env.VAPI_WEBHOOK_SECRET;
  delete process.env.VAPI_WEBHOOK_SECRET;
  const app = express();
  app.use("/api/webhooks", vapiWebhookRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  // Drain: unpark the detached post-call work and give it a beat to
  // finish INSIDE this file's lifetime, then restore shared state.
  dbGate.release();
  await new Promise((r) => setTimeout(r, 50));
  if (savedSecret !== undefined) process.env.VAPI_WEBHOOK_SECRET = savedSecret;
  await new Promise<void>((r) => server.close(() => r()));
});

/** node:http POST — immune to other files' globalThis.fetch stubs. */
function postEvent(
  message: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const payload = JSON.stringify({ message });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/webhooks/vapi",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

describe("end-of-call-report · speed-to-ack", () => {
  it("acks 200 {ack:true} while the DB layer is still pending — persist is detached", async () => {
    const res = await postEvent({
      type: "end-of-call-report",
      endedReason: "customer-ended-call",
      call: { id: "call-ack-order-1" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ack: true });
    // The gate never opened before the ack landed: the handler did NOT
    // await the persist path. (getDb is parked until afterAll.)
    expect(dbGate.opened).toBe(false);
  });

  it("call-end alias takes the same detached path", async () => {
    const res = await postEvent({
      type: "call-end",
      endedReason: "assistant-ended-call",
      call: { id: "call-ack-order-2" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ack: true });
    expect(dbGate.opened).toBe(false);
  });

  it("unknown event types still ack (default branch intact)", async () => {
    const res = await postEvent({ type: "some-future-vapi-event" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ack: true });
  });
});
