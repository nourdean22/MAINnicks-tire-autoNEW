/**
 * mp4Ingest — an externally-produced mp4 must not get a shortcut past the gates.
 *
 * The load-bearing assertions here are the two the surface map flagged as the
 * ways a naive ingest breaks:
 *   1. it must create a reel_jobs row, because the publish gate resolves quality
 *      evidence via reel_jobs.briefId = draft.id; with no row it warn-and-proceeds
 *      (publishing with NO quality decision) and is hard-blocked outright once
 *      REEL_GATE_REQUIRE_JOB is armed.
 *   2. the caption must reach hookText, because the publisher builds the posted
 *      text as `hookText\n\nbodyText` — NOT from briefJson, NOT from
 *      reel_jobs.caption.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { insertValues, ensureDraft, storagePutMock, updateSet } = vi.hoisted(() => ({
  insertValues: vi.fn(),
  ensureDraft: vi.fn(),
  storagePutMock: vi.fn(),
  updateSet: vi.fn(),
}));

// NB: vi.mock paths resolve relative to THIS file, not to the module under
// test. mp4Ingest.ts imports "../storage" / "../db" from server/services/;
// from server/ those are "./storage" / "./db".
vi.mock("./storage", () => ({
  assertDurableStorageForGeneration: vi.fn(),
  storagePut: storagePutMock,
}));

vi.mock("./services/reelInventoryLink", () => ({ ensureReelDraftForJob: ensureDraft }));

vi.mock("./db", () => ({
  getDb: async () => ({
    insert: () => ({ values: (v: unknown) => insertValues(v) }),
    update: () => ({ set: (s: unknown) => ({ where: () => updateSet(s) }) }),
  }),
}));

import { ingestFinishedMp4, looksLikeMp4, MP4_INGEST_FLAG } from "./services/mp4Ingest";

/** Minimal ISO-BMFF header: 4 size bytes then the `ftyp` box tag. */
function fakeMp4(): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(16)]);
}

const INPUT = {
  source: "https://cdn.example.com/finished.mp4",
  topic: "Winter tire check",
  caption: "THREE SIGNS YOUR TIRES ARE DONE",
  origin: "moneyprinter",
};

beforeEach(() => {
  vi.stubEnv(MP4_INGEST_FLAG, "true");
  // The REAL shape drizzle-orm/mysql2 returns: a tuple, not a bare object. The
  // previous mock returned `{ insertId }` — a shape mysql2 never produces — so
  // it hid a defect that would have made every real ingestion throw after
  // uploading the asset and inserting the job row.
  insertValues.mockReset().mockResolvedValue([{ insertId: 4242 }, undefined]);
  updateSet.mockReset().mockResolvedValue({});
  ensureDraft.mockReset().mockResolvedValue("created");
  storagePutMock.mockReset().mockResolvedValue({ key: "k", url: "https://cdn.nickstire.org/reels/ingested/x.mp4" });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(fakeMp4(), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("looksLikeMp4", () => {
  it("accepts an ISO-BMFF ftyp header", () => {
    expect(looksLikeMp4(fakeMp4())).toBe(true);
  });

  it("rejects HTML, text and truncated files — an error page fetched over http is the realistic case", () => {
    expect(looksLikeMp4(Buffer.from("<!doctype html><html>404"))).toBe(false);
    expect(looksLikeMp4(Buffer.alloc(4))).toBe(false);
    expect(looksLikeMp4(Buffer.from(""))).toBe(false);
  });
});

describe("ingestFinishedMp4 · gates", () => {
  it("is OFF unless the flag is exactly 'true' — the repo's requiresFlag convention", async () => {
    for (const raw of ["", "1", "yes", "TRUE", "True"]) {
      vi.stubEnv(MP4_INGEST_FLAG, raw);
      await expect(ingestFinishedMp4(INPUT)).rejects.toThrow(/disabled/i);
    }
    expect(storagePutMock).not.toHaveBeenCalled();
  });

  it("refuses a source that is not an mp4 rather than creating a draft around junk", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(Buffer.from("<html>nope"), { status: 200 })));
    await expect(ingestFinishedMp4(INPUT)).rejects.toThrow(/not an mp4/i);
    expect(ensureDraft).not.toHaveBeenCalled();
  });

  it("requires a caption — it is what actually gets published", async () => {
    await expect(ingestFinishedMp4({ ...INPUT, caption: "   " })).rejects.toThrow(/caption/i);
  });

  it("refuses a presigned URL up front instead of failing at the last publish gate", async () => {
    // Deliberately NO `Signature=<hex>` in this fixture. assertPermanentPublicMediaUrl
    // matches on /X-Amz-|Expires=|Signature=|AWSAccessKeyId/i, so `X-Amz-Expires`
    // exercises exactly the same branch — while a signature-shaped blob makes the
    // line read as a real presigned URL to a secret scanner (gitleaks flagged it).
    storagePutMock.mockResolvedValue({
      key: "k",
      url: "https://s3.amazonaws.com/b/x.mp4?X-Amz-Expires=60",
    });
    await expect(ingestFinishedMp4(INPUT)).rejects.toThrow(/presigned|temporary/i);
    expect(ensureDraft).not.toHaveBeenCalled();
  });
});

describe("ingestFinishedMp4 · the row it produces", () => {
  it("creates a reel_jobs row so the publish gate has quality evidence to resolve", async () => {
    const res = await ingestFinishedMp4(INPUT);

    expect(insertValues).toHaveBeenCalledTimes(1);
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    // briefId === the inventory id is exactly what resolveReelJobId looks up.
    expect(row.briefId).toBe(res.inventoryId);
    expect(row.status).toBe("assembled");
    expect(row.mp4Url).toBe(res.mp4Url);
    expect(res.reelJobId).toBe(4242);
  });

  it("keeps the new status inside reel_jobs.status varchar(20)", async () => {
    await ingestFinishedMp4(INPUT);
    const row = insertValues.mock.calls[0][0] as { status: string };
    expect(row.status.length).toBeLessThanOrEqual(20);
  });

  it("hands the draft to ensureReelDraftForJob with the caption in selectedCaption (which becomes hookText)", async () => {
    await ingestFinishedMp4(INPUT);
    expect(ensureDraft).toHaveBeenCalledTimes(1);
    const args = ensureDraft.mock.calls[0][1] as { briefId: string; mp4Url: string; brief: Record<string, unknown> };
    expect(args.brief.selectedCaption).toBe(INPUT.caption);
    expect(args.brief.origin).toBe("moneyprinter");
  });

  it("persists an audio QA verdict — qualityGate holds a publish without one", async () => {
    // RENDERED_QA_ENABLED on + AUDIO_QA_ENABLED not "false" makes qualityGate
    // require payload.audioQa: "audio was never evaluated, which is not the same
    // as audio passing". This path bypasses assembly, so without running it here
    // every ingested draft reaches approval and then holds forever at publish.
    await ingestFinishedMp4(INPUT);
    const payload = JSON.parse((insertValues.mock.calls[0][0] as { payload: string }).payload);
    expect(payload.audioQa).toBeTruthy();
    expect(typeof payload.audioQa.decision).toBe("string");
    // Never a silent pass: a QA that could not run is recorded as unavailable.
    expect(["completed", "unavailable"]).toContain(payload.audioQa.qaState);
  });

  it("stamps reelJobId into the brief — the direct link resolveReelJobId prefers", async () => {
    await ingestFinishedMp4(INPUT);
    const written = updateSet.mock.calls[0][0] as { briefJson: string };
    expect(JSON.parse(written.briefJson).reelJobId).toBe(4242);
  });

  it("does NOT set bodyText unless one was supplied — it would append to every published caption", async () => {
    await ingestFinishedMp4(INPUT);
    expect(updateSet.mock.calls[0][0]).not.toHaveProperty("bodyText");

    updateSet.mockClear();
    await ingestFinishedMp4({ ...INPUT, bodyText: "Book online." });
    expect(updateSet.mock.calls[0][0]).toHaveProperty("bodyText", "Book online.");
  });

  it("refuses to leave an UNLINKED draft when the job insert returns no id", async () => {
    insertValues.mockResolvedValue([{}, undefined]);
    await expect(ingestFinishedMp4(INPUT)).rejects.toThrow(/no id/i);
    expect(ensureDraft).not.toHaveBeenCalled();
  });

  it("reads insertId out of the mysql2 TUPLE, not off the array", async () => {
    // Reading `.insertId` from the array itself yields undefined -> 0 -> the
    // guard above throws, so a real ingestion uploaded the asset, inserted the
    // job row, and then failed before creating the draft.
    insertValues.mockResolvedValue([{ insertId: 77 }, undefined]);
    const res = await ingestFinishedMp4(INPUT);
    expect(res.reelJobId).toBe(77);
    expect(ensureDraft).toHaveBeenCalledTimes(1);
  });
});
