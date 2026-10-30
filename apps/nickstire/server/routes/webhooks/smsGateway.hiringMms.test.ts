/**
 * A text-to-apply message with a photo (a resume, a certificate) must not run
 * the car-photo pipeline, which auto-replies with a photo assessment. A plain
 * customer photo still does (positive control).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ photo: vi.fn() }));

vi.mock("../../db", () => ({
  getDb: async () => null,
  smsMessageExists: vi.fn(async () => false),
  getOrCreateConversation: vi.fn(async () => ({ id: 4242 })),
  recentInboundExists: vi.fn(async () => false),
  addSmsMessage: vi.fn(async () => undefined),
}));
vi.mock("../../services/smsResponseJobs", () => ({
  ensureResponseObligation: vi.fn(async () => ({ jobId: 7, durable: true, created: true })),
  answerResponseObligation: vi.fn(async () => undefined),
  responseObligationExistsForProviderMsg: vi.fn(async () => true),
  handleInboundResponse: vi.fn(async () => undefined),
}));
vi.mock("../../services/photo-assess-pipeline", () => ({ runPhotoAssess: (...a: unknown[]) => h.photo(...a) }));
vi.mock("../../services/smsInstrumentation", () => ({ recordSmsReply: vi.fn(async () => undefined) }));
vi.mock("../../services/recoveryReplyCapture", () => ({ captureStatedConcernFromReply: vi.fn(async () => undefined) }));
vi.mock("../../services/opportunityQueue", () => ({ captureComplaintOpportunity: vi.fn(async () => undefined) }));

import { smsGatewayWebhookRouter } from "./smsGateway";
import { detachedWork } from "../../_core/gracefulShutdown";

let server: http.Server;
let port: number;
let savedSecret: string | undefined;

beforeAll(async () => {
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

beforeEach(() => h.photo.mockReset().mockResolvedValue(undefined));

function post(body: Record<string, unknown>): Promise<number> {
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
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

const mms = (id: string, message: string) => ({
  event: "sms:received",
  id: `evt-${id}`,
  payload: { messageId: `gw-${id}`, phoneNumber: "+12165550100", message, attachments: ["https://example.test/a.jpg"] },
});

describe("MMS with the text-to-apply token", () => {
  it("skips the car-photo pipeline", async () => {
    expect(await post(mms("job-1", "JOB-APPLY Automotive Technician. My name is Lee"))).toBe(200);
    await detachedWork.settled();
    expect(h.photo).not.toHaveBeenCalled();
  });

  it("CONTROL: a plain customer photo still runs it", async () => {
    expect(await post(mms("car-1", "here is the tire"))).toBe(200);
    await vi.waitFor(() => expect(h.photo).toHaveBeenCalledTimes(1));
  });
});
