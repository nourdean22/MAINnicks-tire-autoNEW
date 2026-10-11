/**
 * tests/ai/sync-drive-memory-in-process.test.ts (R3-14 item 7)
 *
 * The syncDriveMemory chat tool POSTed to its own /api/drive/sync over HTTP
 * with no session cookie. Since R3-10 put requireSession on that route, every
 * call got 401, so the tool never reached the ingest. It also reported ok:true
 * for a 200 whose body said ok:false (OAuth missing, probe failed).
 *
 * The tool must call runDriveIngest in-process (as the operator.syncDrive tRPC
 * mutation does) and carry the ingest's own ok/reason through. fetch is stubbed
 * to answer 401, as the real route now does for a cookieless server call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ runDriveIngest: vi.fn(), fetch: vi.fn() }));

vi.mock("@/lib/brain/drive-ingest", () => ({ runDriveIngest: h.runDriveIngest }));
vi.mock("@/lib/prisma", () => {
  const generic = () => new Proxy({}, { get: () => vi.fn(async () => null) });
  return { prisma: new Proxy({}, { get: () => generic() }) };
});

import { brainTools } from "@/lib/ai/tools/brain";

type Out = { ok: boolean; stored?: number; skipped?: number; reason?: string; error?: string; hint?: string };
const run = () =>
  (brainTools.syncDriveMemory as unknown as { execute: (i: unknown, o: unknown) => Promise<Out> }).execute(
    { force: false },
    { toolCallId: "t1", messages: [] },
  );

beforeEach(() => {
  h.runDriveIngest.mockReset();
  h.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401 }));
  vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("syncDriveMemory reaches the ingest in-process", () => {
  it("runs runDriveIngest with the tool actor and reports its counts", async () => {
    h.runDriveIngest.mockResolvedValue({
      ok: true, stored: 3, skippedCount: 2, categoryCounts: { drive_doc: 3 }, errors: [], durationMs: 40, hint: "3 docs now searchable",
    });
    const out = await run();
    expect(h.runDriveIngest).toHaveBeenCalledWith({ limit: 25, actor: "nick_tool_call", source: "drive_manual_sync" });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: true, stored: 3, skipped: 2 });
  });

  it("an ingest that could not run is NOT reported as success", async () => {
    h.runDriveIngest.mockResolvedValue({
      ok: false, skipped: true, reason: "google_oauth_not_configured", stored: 0, skippedCount: 0,
      categoryCounts: {}, errors: [], durationMs: 1, hint: "Visit /api/oauth/google-data/start to grant Drive read access.",
    });
    const out = await run();
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("google_oauth_not_configured");
  });

  it("a thrown ingest is ok:false with the message", async () => {
    h.runDriveIngest.mockRejectedValue(new Error("drive api down"));
    const out = await run();
    expect(out).toMatchObject({ ok: false, error: "drive api down" });
  });
});
