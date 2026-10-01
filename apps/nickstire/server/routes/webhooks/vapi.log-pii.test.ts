/**
 * A failed query in the Vapi webhook logs what failed, never the caller's data
 * (PROTECTED-CORE rule 5; found in the post-merge review of #2839, 2026-10-01).
 *
 * drizzle 0.45 wraps every driver error in a DrizzleQueryError whose message is
 * "Failed query: <sql>\nparams: <every bound value>". Fifteen catch blocks in
 * the webhook logged `err.message`, so one failed `vapi_call_logs` insert copied
 * the caller's phone number, name and AI call summary into the logs, and a tool
 * whose procedure failed on a query handed the same text back to Vapi as the
 * tool result. They now go through logSafeErrorMessage: a database error
 * becomes class names and driver codes, any other error keeps its message.
 *
 * Through the REAL express route (harness shape of vapi.call-end-drain.test.ts).
 * Positive control (main at 84c54be97): both cases fail there, on the phone
 * number in the logged insert error and in the tool result's details.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { DrizzleQueryError } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const PHONE = "+12165550199";
const NAME = "Zelda Quartermaine";
const SUMMARY = "SENSITIVE-SUMMARY: her brakes grind on the left";

const h = vi.hoisted(() => ({ logs: [] as Array<{ level: string; msg: string; meta: unknown }> }));

function failedQuery(params: unknown[], code: string, errno: number, driverText: string): DrizzleQueryError {
  const driver = Object.assign(new Error(driverText), { code, errno, sqlMessage: driverText });
  return new DrizzleQueryError("insert into `vapi_call_logs` (`vapiCallId`, `phoneNumber`, `customerName`, `aiSummary`) values (?, ?, ?, ?)", params, driver);
}

vi.mock("../../lib/logger", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const capture = (level: string) => (msg: string, meta?: unknown) => {
    h.logs.push({ level, msg, meta });
  };
  return {
    ...actual,
    createLogger: () => ({ debug: capture("debug"), info: capture("info"), warn: capture("warn"), error: capture("error") }),
  };
});

/** Every chained call resolves to []; only the vapi_call_logs insert fails. */
function fakeDb(): unknown {
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, prop) => (prop === "then" ? (resolve: (v: unknown) => void) => resolve([]) : () => chain),
    apply: () => chain,
  });
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") return undefined;
        if (prop === "insert") {
          return () => ({
            values: () =>
              Promise.reject(failedQuery(["call-pii-1", PHONE, NAME, SUMMARY], "ER_DATA_TOO_LONG", 1406, "Data too long for column 'aiSummary' at row 1")),
          });
        }
        return () => chain;
      },
    },
  );
}

vi.mock("../../db", () => ({ getDb: async () => fakeDb() }));

vi.mock("../../services/voice-call-state", () => ({
  recordCallState: vi.fn(async () => {}),
  classifyToolToState: () => null,
  getCallStateHistory: vi.fn(async () => []),
}));

vi.mock("../../routers/voiceAgent", () => ({
  voiceAgentRouter: {
    createCaller: () => ({
      escalate: async () => {
        // What tRPC hands back when a procedure's insert fails: the wrapper's
        // text (SQL + params) becomes the TRPCError's message.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          cause: failedQuery([NAME, PHONE, "brakes"], "ER_DUP_ENTRY", 1062, `Duplicate entry '${PHONE}' for key 'uq_callback_phone'`),
        });
      },
    }),
  },
}));

import { vapiWebhookRouter } from "./vapi";
import { detachedWork } from "../../_core/gracefulShutdown";

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

const leaked = (text: string) => [PHONE, NAME, SUMMARY].filter((v) => text.includes(v));

describe("the Vapi webhook never logs a failed query's bound values", () => {
  it("a failed vapi_call_logs insert logs the error's classes and code, not the caller's phone, name or summary", async () => {
    h.logs.length = 0;
    const res = await postEvent({
      type: "end-of-call-report",
      endedReason: "customer-ended-call",
      call: { id: "call-pii-1", customer: { number: PHONE, name: NAME } },
      summary: SUMMARY,
    });
    expect(res).toEqual({ status: 200, body: { ack: true } });
    await detachedWork.settled();

    // The instrument fired: the insert failure was logged at all.
    const insertLog = h.logs.find((l) => l.msg === "vapi_call_logs insert failed");
    expect(insertLog, JSON.stringify(h.logs.map((l) => l.msg))).toBeDefined();
    expect(insertLog?.meta).toEqual({ error: "DrizzleQueryError > Error ER_DATA_TOO_LONG/1406" });
    expect(leaked(JSON.stringify(h.logs))).toEqual([]);
  });

  it("a tool whose procedure failed on a query reports the error's classes to Vapi and the logs, not the caller's data", async () => {
    h.logs.length = 0;
    const res = await postEvent({
      type: "tool-calls",
      call: { id: "call-pii-2", customer: { number: PHONE } },
      toolCalls: [
        {
          id: "tc-1",
          type: "function",
          function: { name: "escalate", arguments: JSON.stringify({ name: NAME, phone: PHONE, reason: "brakes" }) },
        },
      ],
    });
    expect(res.status).toBe(200);
    const results = (res.body as { results: Array<{ toolCallId: string; result: string }> }).results;
    expect(results).toHaveLength(1);
    const result = JSON.parse(results[0].result) as { error: string; details: string };
    expect(result.error).toBe("Tool execution failed");
    expect(result.details).toBe("TRPCError INTERNAL_SERVER_ERROR > DrizzleQueryError > Error ER_DUP_ENTRY/1062");
    expect(leaked(results[0].result)).toEqual([]);

    const dispatchLog = h.logs.find((l) => l.msg === "Tool call dispatch failed");
    expect(dispatchLog, JSON.stringify(h.logs.map((l) => l.msg))).toBeDefined();
    expect(leaked(JSON.stringify(h.logs))).toEqual([]);
  });
});
