/**
 * F5 · an inbound customer text's answer, which runs AFTER the 200, is waited
 * for by the SIGTERM drain.
 *
 * Through the REAL express route: the durable obligation is recorded before
 * the ack (ROS-058, unchanged here), then answerResponseObligation runs
 * detached. It parks on a gate, so the answer is provably still in flight
 * after the 200; a shutdown started then must not exit until it finishes.
 *
 * Positive control (origin/main 91ab0048): the answer ran in a bare
 * `(async () => ...)()` IIFE, invisible to every drain source once the
 * response was sent, so the shutdown exited 0 with the answer mid-flight —
 * a text acked and not answered until a sweeper found the stale job.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const answer = vi.hoisted(() => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  return { gate, release: () => release(), started: false, finished: false };
});

vi.mock("../../db", () => ({
  getDb: async () => null,
  smsMessageExists: vi.fn(async () => false),
  getOrCreateConversation: vi.fn(async () => ({ id: 4242 })),
  recentInboundExists: vi.fn(async () => false),
  addSmsMessage: vi.fn(async () => undefined),
}));

vi.mock("../../services/smsResponseJobs", () => ({
  ensureResponseObligation: vi.fn(async () => ({ jobId: 7, durable: true, created: true })),
  answerResponseObligation: vi.fn(async () => {
    answer.started = true;
    await answer.gate;
    answer.finished = true;
  }),
  responseObligationExistsForProviderMsg: vi.fn(async () => true),
  handleInboundResponse: vi.fn(async () => undefined),
}));

// Observers the route fires alongside the answer — inert here; not under test.
vi.mock("../../services/smsInstrumentation", () => ({ recordSmsReply: vi.fn(async () => undefined) }));
vi.mock("../../services/recoveryReplyCapture", () => ({ captureStatedConcernFromReply: vi.fn(async () => undefined) }));
vi.mock("../../services/opportunityQueue", () => ({ captureComplaintOpportunity: vi.fn(async () => undefined) }));

import { smsGatewayWebhookRouter } from "./smsGateway";
import { createGracefulShutdown, detachedWork } from "../../_core/gracefulShutdown";

let server: http.Server;
let port: number;
let savedSecret: string | undefined;

beforeAll(async () => {
  // Non-production + no secret → the route's documented unsigned dev path.
  savedSecret = process.env.SHOP_SMS_GATEWAY_WEBHOOK_SECRET;
  delete process.env.SHOP_SMS_GATEWAY_WEBHOOK_SECRET;
  const app = express();
  app.use(express.json());
  app.use("/api/webhooks", smsGatewayWebhookRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  answer.release();
  await detachedWork.settled();
  if (savedSecret !== undefined) process.env.SHOP_SMS_GATEWAY_WEBHOOK_SECRET = savedSecret;
  await new Promise<void>((r) => server.close(() => r()));
});

/** node:http POST — immune to other files' globalThis.fetch stubs. */
function post(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/webhooks/sms-gateway",
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

describe("sms:received · the post-ack answer is drained on SIGTERM", () => {
  it("a shutdown started after the 200 waits for the answer, then exits 0", async () => {
    const res = await post({
      event: "sms:received",
      id: "evt-drain-1",
      payload: { messageId: "gw-msg-drain-1", phoneNumber: "+12165550100", message: "how much for 4 tires" },
    });
    expect(res).toEqual({ status: 200, body: { received: true } });
    await vi.waitFor(() => expect(answer.started).toBe(true));
    expect(detachedWork.pending()).toContain("sms-gateway:answer");

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
    expect(exit).not.toHaveBeenCalled(); // the answer is still in flight
    expect(answer.finished).toBe(false);

    answer.release();
    await done;
    expect(answer.finished).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
