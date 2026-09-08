/**
 * tests/security/inbound-crm-header-secret.test.ts · 2026-09-07
 *
 * The inbound-CRM webhook accepted its shared secret as `?secret=` "transitionally"
 * since #597 (2026-07-07). Query-string secrets land in every proxy, CDN and
 * access log on the way in. The retained Railway log window held zero
 * `inbound_crm_*` lines, so no caller was on that path; the fallback is gone.
 *
 * Drives the REAL route: header → passes auth (and then fails on the body, which
 * proves auth passed); query-only → 401 with the reason logged; nothing → 401;
 * unconfigured secret → 503 (fail closed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  // apiHandler counts queries per request; the route itself never reaches a
  // query in these cases (auth or the JSON parse stops it first).
  prisma: new Proxy({}, { get: () => () => Promise.resolve(null) }),
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn(() => 0),
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ tracedAiChat: vi.fn().mockResolvedValue({ content: "", provider: "none" }) }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: vi.fn().mockResolvedValue("inbox") }));
// One fake logger shared by the route (withSurface) and apiHandler (withContext /
// withSurface); every derived logger IS this object so the assertions below see
// the route's warn/error calls whichever path minted the child.
const logs = vi.hoisted(() => {
  const l: Record<string, unknown> = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  l.withSurface = () => l;
  l.withContext = () => l;
  return l as { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; withSurface: () => unknown; withContext: () => unknown };
});
vi.mock("@/lib/logger", () => ({ logger: logs }));

import { POST } from "@/app/api/webhooks/inbound-crm/route";

const URL_ = "https://example.test/api/webhooks/inbound-crm";
const post = (url: string, headers: Record<string, string> = {}, body = "{not json") =>
  new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

describe("POST /api/webhooks/inbound-crm secret handling", () => {
  const ORIGINAL = { sync: process.env.STATENOUR_SYNC_KEY, bridge: process.env.BRIDGE_API_KEY };
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STATENOUR_SYNC_KEY = "test-sync-key";
    delete process.env.BRIDGE_API_KEY;
  });
  afterEach(() => {
    if (ORIGINAL.sync === undefined) delete process.env.STATENOUR_SYNC_KEY; else process.env.STATENOUR_SYNC_KEY = ORIGINAL.sync;
    if (ORIGINAL.bridge === undefined) delete process.env.BRIDGE_API_KEY; else process.env.BRIDGE_API_KEY = ORIGINAL.bridge;
  });

  it("the x-sync-key header authenticates (the request then fails on its malformed body — 400 — proving auth passed)", async () => {
    const res = await POST(post(URL_, { "x-sync-key": "test-sync-key" }));
    // Exactly 400 "Invalid JSON body": the only way to reach the body parse is
    // to pass the secret check. A 500 here would mean the compare itself blew
    // up (which is what an under-mocked safeEqual produced on the first run).
    expect(res.status).toBe(400);
    expect(logs.warn).not.toHaveBeenCalledWith("inbound_crm_unauthorized", expect.anything());
  });

  it("a correct secret sent ONLY as ?secret= is refused, and the log says why", async () => {
    const res = await POST(post(`${URL_}?secret=test-sync-key`));
    expect(res.status).toBe(401);
    expect(logs.warn).toHaveBeenCalledWith(
      "inbound_crm_unauthorized",
      expect.objectContaining({ presented_via: "query", detail: expect.stringContaining("query path was retired") }),
    );
  });

  it("no secret at all is refused", async () => {
    const res = await POST(post(URL_));
    expect(res.status).toBe(401);
    expect(logs.warn).toHaveBeenCalledWith("inbound_crm_unauthorized", expect.objectContaining({ presented_via: "none" }));
  });

  it("a wrong header secret is refused", async () => {
    const res = await POST(post(URL_, { "x-sync-key": "nope" }));
    expect(res.status).toBe(401);
  });

  it("fails CLOSED when no secret is configured", async () => {
    delete process.env.STATENOUR_SYNC_KEY;
    const res = await POST(post(URL_, { "x-sync-key": "anything" }));
    expect(res.status).toBe(503);
    expect(logs.error).toHaveBeenCalledWith("inbound_crm_secret_unconfigured");
  });
});
