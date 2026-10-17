/**
 * Telegram job, lane 2 fix round (#3097 review P2-4) - the phone-notes routes
 * wrote no audit trail. They now use the same one /api/mcp uses: a refusal
 * goes through classifyBridgeFailure + auditBridgeRejection, and every
 * authenticated read or ack writes a bridge_call_logs row (auditBridgeCall).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  vi.stubEnv("AGENT_BRIDGE_ENABLED", "true");
  vi.stubEnv("AGENT_BRIDGE_TOKEN_NOTES", "test-notes-token-value");
  const bridgeCallLog = { create: vi.fn(async (..._a: unknown[]) => ({})) };
  const captureInboxItem = {
    findMany: vi.fn(async () => [{ id: "n001", createdAt: new Date("2026-10-16T12:00:00Z"), summary: "a note" }]),
    findFirst: vi.fn(async () => null),
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  return { bridgeCallLog, prisma: { bridgeCallLog, captureInboxItem }, rejection: vi.fn(async (..._a: unknown[]) => undefined) };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/agent-bridge/audit", async (orig) => ({
  ...(await orig<typeof import("@/lib/agent-bridge/audit")>()),
  auditBridgeRejection: h.rejection,
}));

import { GET } from "@/app/api/agent-bridge/notes/route";
import { POST } from "@/app/api/agent-bridge/notes/ack/route";

const get = (headers: Record<string, string>) => GET(new NextRequest("http://localhost/api/agent-bridge/notes", { headers }));
const ack = (headers: Record<string, string>) =>
  POST(new NextRequest("http://localhost/api/agent-bridge/notes/ack", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ ids: ["n001"] }),
  }));
const NOTES = { authorization: "Bearer test-notes-token-value" };

afterAll(() => vi.unstubAllEnvs());
beforeEach(() => vi.clearAllMocks());

describe("phone-notes routes write the bridge audit trail", () => {
  it("a refused read is audited as a bridge rejection", async () => {
    expect((await get({})).status).toBe(401);
    expect(h.rejection).toHaveBeenCalledWith(expect.objectContaining({ protocol: "notes", reason: "unauthorized" }));
  });

  it("a refused ack with a wrong token is audited as forbidden", async () => {
    expect((await ack({ authorization: "Bearer wrong" })).status).toBe(403);
    expect(h.rejection).toHaveBeenCalledWith(expect.objectContaining({ protocol: "notes", reason: "forbidden" }));
  });

  it("a successful read writes a bridge_call_logs row", async () => {
    expect((await get(NOTES)).status).toBe(200);
    expect(h.bridgeCallLog.create).toHaveBeenCalledTimes(1);
    expect(h.bridgeCallLog.create.mock.calls[0][0]).toMatchObject({
      data: { protocol: "notes", clientId: "notes-client", scope: "notes", toolName: "phone_notes_read", status: "success" },
    });
  });

  it("a successful ack writes a bridge_call_logs row", async () => {
    expect((await ack(NOTES)).status).toBe(200);
    expect(h.bridgeCallLog.create.mock.calls[0][0]).toMatchObject({
      data: { protocol: "notes", toolName: "phone_notes_ack", status: "success" },
    });
  });
});
