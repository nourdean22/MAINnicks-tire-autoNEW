/**
 * tests/api/sync-queue-publish.test.ts · publish-status contract (2026-08-03).
 *
 * Two defects, one root cause: THE PRODUCER WAS WRITING A STATUS THAT BELONGS
 * TO THE CLAIMING WORKER.
 *
 * D1 · POST /api/sync/queue {action:"publish"} — and a byte-identical copy on
 *      operator.actOnPublishQueueItem — stamped status="published" +
 *      publishedAt BEFORE dispatching, then swallowed failures in a try/catch
 *      that only console.error'd. "published" is not in the worker's claim set,
 *      so the operator's row could never be claimed, while publishSocialPost
 *      created a SECOND row that the worker finalized in its place.
 *
 * D2 · publishSocialPost created that row with status:"rendering" — the
 *      worker's own in-flight marker, not a claimable state. #658 (2a85f08bd)
 *      replaced the worker's unconditional `update(status:"rendering")` with a
 *      compare-and-set over (pending|approved|scheduled) but left this producer
 *      alone, so from #658 onward every async publish was claimed-out and
 *      skipped while still returning {ok:true, succeeded:N, failed:0}.
 *
 * Contract locked here: only the worker writes "rendering"; only the worker
 * writes "published"/"rejected"; producers hand over a CLAIMABLE row exactly
 * once. These tests drive the REAL dispatcher — only prisma, inngest and auth
 * are mocked — so they fail if any layer regresses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { findUnique, update, create, inngestSend } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  inngestSend: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialPublishQueue: { findUnique, update, create },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
    errorLog: { create: vi.fn().mockResolvedValue({}) },
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));

vi.mock("@/lib/content/drafts", () => ({
  listDrafts: vi.fn(),
  approveDraft: vi.fn(),
  rejectDraft: vi.fn(),
  markScheduled: vi.fn(),
}));

vi.mock("@/lib/inngest/client", () => ({ getInngest: () => ({ send: inngestSend }) }));

import { POST } from "@/app/api/sync/queue/route";
import { publishSocialPost } from "@/lib/services/social-actions";

/**
 * The worker's claim set, read from its SOURCE rather than copied here. If
 * anyone widens or narrows the claim, this file fails instead of silently
 * drifting from the producer again — which is the whole defect.
 */
function workerClaimStatuses(): string[] {
  const src = readFileSync(
    join(__dirname, "../../lib/inngest/functions/social-publish.ts"),
    "utf8",
  );
  const m = src.match(/status:\s*\{\s*in:\s*\[([^\]]+)\]/);
  if (!m) throw new Error("could not locate the worker's claim set — did social-publish.ts change shape?");
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

const ROW = {
  id: "row-1",
  content: "Winter tire check reel",
  status: "approved",
  imageUrl: "https://cdn.example.com/reel.mp4",
  platforms: ["instagram"],
  kind: "reel",
  deletedAt: null,
};

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://test/api/sync/queue", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  // The production dispatch path is gated on NODE_ENV !== "test" — which is
  // exactly why no existing test ever exercised it, and why D2 shipped.
  vi.stubEnv("NODE_ENV", "production");
  findUnique.mockReset().mockResolvedValue({ ...ROW });
  update.mockReset().mockResolvedValue({ ...ROW });
  create.mockReset().mockImplementation(async (args: any) => ({ id: "created-row", ...args.data }));
  inngestSend.mockReset().mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/sync/queue publish · does not fabricate a terminal status", () => {
  it("never writes published/publishedAt — that is the worker's to write", async () => {
    const res = await post({ id: "row-1", action: "publish" });
    expect(res.status).toBe(200);

    const terminalWrites = update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.status === "published" || c[0]?.data?.publishedAt,
    );
    expect(terminalWrites).toEqual([]);
  });

  it("leaves the row in a status the worker can still claim", async () => {
    await post({ id: "row-1", action: "publish" });
    const claimable = workerClaimStatuses();
    expect(claimable).toContain(ROW.status);
    for (const call of update.mock.calls) {
      const next = (call[0] as any)?.data?.status;
      if (next) expect(claimable).toContain(next);
    }
  });

  it("hands the worker the EXISTING row — no duplicate queue row", async () => {
    await post({ id: "row-1", action: "publish" });
    expect(create).not.toHaveBeenCalled();
    expect(inngestSend).toHaveBeenCalledTimes(1);
    const sent = inngestSend.mock.calls[0][0];
    expect(sent.name).toBe("social/publish");
    expect(sent.data.draftId).toBe("row-1");
    expect(sent.data.videoUrl).toBe("https://cdn.example.com/reel.mp4");
  });

  it("reports dispatched, not published", async () => {
    const res = await post({ id: "row-1", action: "publish" });
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('"published":true');
    expect(body).toContain('"dispatched":true');
  });
});

describe("POST /api/sync/queue publish · refuses instead of no-opping", () => {
  it("409s a row the worker could never claim, rather than reporting success", async () => {
    findUnique.mockResolvedValue({ ...ROW, status: "rendering" });
    const res = await post({ id: "row-1", action: "publish" });
    expect(res.status).toBe(409);
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("400s a row with no publishable platform — it used to report published", async () => {
    findUnique.mockResolvedValue({ ...ROW, platforms: [] });
    const res = await post({ id: "row-1", action: "publish" });
    expect(res.status).toBe(400);
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("404s a missing or soft-deleted row", async () => {
    findUnique.mockResolvedValue(null);
    expect((await post({ id: "nope", action: "publish" })).status).toBe(404);

    findUnique.mockResolvedValue({ ...ROW, deletedAt: new Date() });
    expect((await post({ id: "row-1", action: "publish" })).status).toBe(404);
  });

  it("surfaces a dispatch failure instead of swallowing it into ok:true", async () => {
    inngestSend.mockRejectedValue(new Error("inngest unreachable"));
    const res = await post({ id: "row-1", action: "publish" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await res.json())).not.toContain('"dispatched":true');
  });
});

describe("publishSocialPost · hands the worker a claimable row", () => {
  it("creates the row in a status the worker's claim set accepts (never 'rendering')", async () => {
    await publishSocialPost(
      { platforms: ["instagram"], imageUrl: "https://cdn.example.com/a.jpg", caption: "hi" },
      undefined,
    );

    expect(create).toHaveBeenCalledTimes(1);
    const status = create.mock.calls[0][0].data.status;
    expect(status).not.toBe("rendering");
    expect(workerClaimStatuses()).toContain(status);
  });

  it("reports queued — never a success count derived from the input array", async () => {
    const res = await publishSocialPost(
      { platforms: ["instagram", "facebook"], imageUrl: "https://cdn.example.com/a.jpg", caption: "hi" },
      undefined,
    );

    // Nothing has contacted Meta at this point. The old shape returned
    // succeeded:2/failed:0 straight off the input array, which the publish tab
    // rendered as "Published to 2 channels".
    expect(res.queued).toBe(true);
    expect(res.succeeded).toBe(0);
    expect(res.failed).toBe(0);
    expect(res.results).toEqual([]);
  });

  it("reuses a supplied draftId instead of creating a second row", async () => {
    await publishSocialPost(
      {
        draftId: "row-1",
        platforms: ["instagram"],
        imageUrl: "https://cdn.example.com/a.jpg",
        caption: "hi",
      },
      undefined,
    );

    expect(create).not.toHaveBeenCalled();
    expect(inngestSend.mock.calls[0][0].data.draftId).toBe("row-1");
  });
});

/**
 * `imageUrl` means the VIDEO on a reel row — render-complete writes the
 * compiled video into it, /render treats null as "not rendered yet", and
 * dispatchQueuedPublish reads a reel's video back out of it. This producer
 * alone stored the COVER there, so a reel row lied twice: /render skipped it as
 * already-rendered, and re-dispatching it handed Meta a JPEG as the Reel video.
 */
describe("queue rows use one meaning for imageUrl", () => {
  it("a reel row stores the VIDEO in imageUrl, not the cover", async () => {
    await publishSocialPost(
      {
        platforms: ["instagram"],
        videoUrl: "https://cdn.example.com/reel.mp4",
        imageUrl: "https://cdn.example.com/cover.jpg",
        caption: "hi",
      },
      undefined,
    );

    const data = create.mock.calls[0][0].data;
    expect(data.kind).toBe("reel");
    expect(data.imageUrl).toBe("https://cdn.example.com/reel.mp4");
    // /render claims reels whose imageUrl is null. A reel row carrying its
    // video can never be mistaken for one still awaiting a render.
    expect(data.imageUrl).not.toBeNull();
    // The cover is preserved rather than lost.
    expect(data.sourceMetadata).toEqual({ coverUrl: "https://cdn.example.com/cover.jpg" });
  });

  it("a plain post still stores its image in imageUrl", async () => {
    await publishSocialPost(
      { platforms: ["instagram"], imageUrl: "https://cdn.example.com/a.jpg", caption: "hi" },
      undefined,
    );
    const data = create.mock.calls[0][0].data;
    expect(data.kind).toBe("post");
    expect(data.imageUrl).toBe("https://cdn.example.com/a.jpg");
  });

  it("dispatching a queued reel sends its video AND its stored cover", async () => {
    findUnique.mockResolvedValue({
      ...ROW,
      imageUrl: "https://cdn.example.com/reel.mp4",
      sourceMetadata: { coverUrl: "https://cdn.example.com/cover.jpg" },
    });

    await post({ id: "row-1", action: "publish" });

    const sent = inngestSend.mock.calls[0][0].data;
    expect(sent.videoUrl).toBe("https://cdn.example.com/reel.mp4");
    // Previously the cover was dropped on every queue dispatch.
    expect(sent.imageUrl).toBe("https://cdn.example.com/cover.jpg");
  });
});
