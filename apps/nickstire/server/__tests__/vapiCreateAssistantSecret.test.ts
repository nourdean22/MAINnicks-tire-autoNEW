/**
 * THE ADMIN "CREATE ASSISTANT" BUTTON SENT THE VAPI WEBHOOK SECRET TO THE
 * BROWSER -- 2026-10-01.
 *
 * createProductionAssistant injects VAPI_WEBHOOK_SECRET into the config as
 * server.secret (Vapi authenticates its webhook calls to us with it) and then
 * returned that config. The admin `vapi.createAssistant` mutation passes the
 * result straight to the browser, where VapiPanel reads only success,
 * assistantId and error. So the credential behind PROTECTED-CORE's "VAPI
 * webhook authentication" sat in a tRPC response for nothing (rule 5).
 *
 * Asserted at the consumer end: the mutation's response, through a real
 * caller. The CONTROL proves the instrument can see the secret: the request
 * to Vapi still carries it, so webhook authentication is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { vapiRouter } from "../routers/vapi";
import type { TrpcContext } from "../_core/context";

const SECRET = "whsec-test-6f1d2c9a8b7e4d3c";
const ORIGINAL_KEY = process.env.VAPI_API_KEY;
const ORIGINAL_SECRET = process.env.VAPI_WEBHOOK_SECRET;

const sentBodies: string[] = [];

function adminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@nickstire.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeEach(() => {
  process.env.VAPI_API_KEY = "test-key";
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  sentBodies.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    sentBodies.push(String(init?.body ?? ""));
    return { ok: true, status: 201, json: async () => ({ id: "asst_created_1" }), text: async () => "" };
  }) as unknown as typeof fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Delete first, then restore: `if (orig) env.X = orig` leaks when orig was
  // undefined, and assigning undefined stores the string "undefined".
  delete process.env.VAPI_API_KEY;
  delete process.env.VAPI_WEBHOOK_SECRET;
  if (ORIGINAL_KEY !== undefined) process.env.VAPI_API_KEY = ORIGINAL_KEY;
  if (ORIGINAL_SECRET !== undefined) process.env.VAPI_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

describe("vapi.createAssistant keeps the webhook secret on the server", () => {
  it("CONTROL - the request to Vapi still carries the secret", async () => {
    await vapiRouter.createCaller(adminContext()).createAssistant({ serverUrl: "https://nickstire.org/api/webhooks/vapi" });
    expect(sentBodies).toHaveLength(1);
    const sent = JSON.parse(sentBodies[0]) as { server?: { secret?: string; url?: string } };
    expect(sent.server?.url).toBe("https://nickstire.org/api/webhooks/vapi");
    expect(sent.server?.secret).toBe(SECRET);
  });

  it("the response the admin browser receives has no secret, and still names the assistant", async () => {
    const result = await vapiRouter.createCaller(adminContext()).createAssistant({ serverUrl: "https://nickstire.org/api/webhooks/vapi" });
    expect(result).toMatchObject({ success: true, assistantId: "asst_created_1" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
