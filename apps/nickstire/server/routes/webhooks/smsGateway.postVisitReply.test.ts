/**
 * The post-visit text promises "text us here" (lib/postVisitText.ts). That is true only if a
 * customer's reply to the shop line is stored where a person reads it and a duty to answer is
 * recorded. Through the REAL express route: the reply must reach addSmsMessage as an inbound row
 * (the admin Messages inbox reads smsMessages) and ensureResponseObligation (the durable answer
 * duty), both before the 200.
 *
 * Mocks are the same inert set as smsGateway.answer-drain.test.ts; only the two consumers are
 * asserted.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const addSmsMessage = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
const ensureResponseObligation = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ jobId: 7, durable: true, created: true })),
);

vi.mock("../../db", () => ({
  getDb: async () => null,
  smsMessageExists: vi.fn(async () => false),
  getOrCreateConversation: vi.fn(async () => ({ id: 4242 })),
  recentInboundExists: vi.fn(async () => false),
  addSmsMessage,
}));

vi.mock("../../services/smsResponseJobs", () => ({
  ensureResponseObligation,
  answerResponseObligation: vi.fn(async () => undefined),
  responseObligationExistsForProviderMsg: vi.fn(async () => true),
  handleInboundResponse: vi.fn(async () => undefined),
}));

vi.mock("../../services/smsInstrumentation", () => ({ recordSmsReply: vi.fn(async () => undefined) }));
vi.mock("../../services/recoveryReplyCapture", () => ({ captureStatedConcernFromReply: vi.fn(async () => undefined) }));
vi.mock("../../services/opportunityQueue", () => ({ captureComplaintOpportunity: vi.fn(async () => undefined) }));

import { smsGatewayWebhookRouter } from "./smsGateway";
import { detachedWork } from "../../_core/gracefulShutdown";

let server: http.Server;
let port: number;
let savedSecret: string | undefined;

beforeAll(async () => {
  // Non-production + no secret: the route's documented unsigned dev path.
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
  await detachedWork.settled();
  if (savedSecret !== undefined) process.env.SHOP_SMS_GATEWAY_WEBHOOK_SECRET = savedSecret;
  await new Promise<void>((r) => server.close(() => r()));
});

/** node:http POST, immune to other files' globalThis.fetch stubs. */
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

describe("a reply to the post-visit text", () => {
  it("is stored as an inbound row the Messages inbox reads, and records the duty to answer it", async () => {
    const reply = "The brakes still feel soft since the visit";
    const res = await post({
      event: "sms:received",
      id: "evt-postvisit-1",
      payload: { messageId: "gw-msg-postvisit-1", phoneNumber: "+12165550142", message: reply },
    });
    expect(res).toEqual({ status: 200, body: { received: true } });
    expect(addSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 4242, direction: "inbound", body: reply }),
    );
    expect(ensureResponseObligation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 4242, body: reply, providerMsgId: "gw-msg-postvisit-1" }),
    );
  });
});
