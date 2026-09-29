/**
 * F5 · the Vapi end-of-call work that runs AFTER the 200 is waited for by the
 * SIGTERM drain.
 *
 * Through the REAL express route (same harness shape as
 * vapi.call-end-ack.test.ts): the DB layer parks on a gate, so the detached
 * processCallEndReport is provably still running after the ack. A shutdown
 * started then must not exit until the gate opens.
 *
 * Positive control (origin/main 91ab0048): the call was a bare
 * `void processCallEndReport(...)`, invisible to every drain source once the
 * response was sent — the import below failed there, and with the tracker
 * but not the call-site wrap, `pending()` stays empty and the exit fires at once.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const dbGate = vi.hoisted(() => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  return { gate, release: () => release(), opened: false };
});

vi.mock("../../db", () => ({
  getDb: async () => {
    await dbGate.gate;
    dbGate.opened = true;
    return null; // null db → every persist/dispatch path no-ops safely
  },
}));

vi.mock("../../services/voice-call-state", () => ({
  recordCallState: vi.fn(async () => {}),
  classifyToolToState: () => null,
  getCallStateHistory: vi.fn(async () => []),
}));

import { vapiWebhookRouter } from "./vapi";
import { createGracefulShutdown, detachedWork } from "../../_core/gracefulShutdown";

let server: http.Server;
let port: number;
let savedSecret: string | undefined;

beforeAll(async () => {
  savedSecret = process.env.VAPI_WEBHOOK_SECRET;
  delete process.env.VAPI_WEBHOOK_SECRET;
  const app = express();
  app.use("/api/webhooks", vapiWebhookRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  dbGate.release();
  await detachedWork.settled();
  if (savedSecret !== undefined) process.env.VAPI_WEBHOOK_SECRET = savedSecret;
  await new Promise<void>((r) => server.close(() => r()));
});

/** node:http POST — immune to other files' globalThis.fetch stubs. */
function postEvent(message: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const payload = JSON.stringify({ message });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/webhooks/vapi",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

describe("end-of-call-report · post-ack work is drained on SIGTERM", () => {
  it("a shutdown started after the ack waits for processCallEndReport, then exits 0", async () => {
    const res = await postEvent({
      type: "end-of-call-report",
      endedReason: "customer-ended-call",
      call: { id: "call-drain-1" },
    });
    expect(res).toEqual({ status: 200, body: { ack: true } });
    expect(dbGate.opened).toBe(false);
    expect(detachedWork.pending()).toContain("vapi:end-of-call");

    const exit = vi.fn();
    const shutdown = createGracefulShutdown({
      graceMs: 10_000,
      exit,
      log: { info: () => {}, warn: () => {} },
      stops: [],
      sources: [detachedWork],
    });
    const done = shutdown();
    await new Promise((r) => setTimeout(r, 50));
    expect(exit).not.toHaveBeenCalled(); // the post-call work is still parked on the DB gate

    dbGate.release();
    await done;
    expect(dbGate.opened).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
    expect(detachedWork.pending()).toEqual([]);
  });
});
