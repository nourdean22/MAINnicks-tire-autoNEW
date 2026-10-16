import { afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { attachExternalClips } from "./externalClips";
import { shouldDiscloseAi } from "../../shared/reelDisclosure";

// Fixtures only: a fake drizzle-shaped db, fake fetch/probe/storage. Nothing
// here reaches a real database, a vendor CDN or S3.

const MP4 = (tag: number) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(16, tag)]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

const beat = (n: number, extra: Record<string, unknown> = {}) => ({
  beatNumber: n, startSecond: (n - 1) * 4, endSecond: n * 4, visual: `macro shot of a brake rotor, beat ${n}`, caption: `c${n}`, ...extra,
});

function job(over: Partial<{ status: string; beats: unknown[]; clipUrlsJson: string | null; payloadExtra: Record<string, unknown> }> = {}) {
  const beats = over.beats ?? [1, 2, 3, 4, 5, 6].map((n) => beat(n));
  return {
    id: 2100001,
    status: over.status ?? "needs_regen",
    payload: JSON.stringify({ topic: "brake rotor", heroAssetId: "ma_9d6743c4", motionLens: "product_ad_macro", storyboardBeats: beats, ...(over.payloadExtra ?? {}) }),
    clipUrlsJson: over.clipUrlsJson === undefined ? null : over.clipUrlsJson,
  };
}

function fakeDb(row: ReturnType<typeof job> | null, affectedRows = 1) {
  const updates: Array<{ set: Record<string, unknown>; where: unknown }> = [];
  const database = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async (where: unknown) => { updates.push({ set, where }); return [{ affectedRows }]; },
      }),
    }),
  };
  return { database, updates };
}

const vendor = (n: number) => `https://cdn.higgsfield.example/u/abc/${n}.mp4?sig=x`;
const urls = (count: number) => Array.from({ length: count }, (_, i) => vendor(i + 1));

function harness(opts: { row?: ReturnType<typeof job> | null; affectedRows?: number; bodies?: Map<string, Buffer | Error>; durations?: Map<Buffer, number>; durable?: boolean } = {}) {
  const { database, updates } = fakeDb(opts.row === undefined ? job() : opts.row, opts.affectedRows ?? 1);
  const buffers = new Map<string, Buffer>();
  const fetchClip = vi.fn(async (url: string) => {
    const b = opts.bodies?.get(url);
    if (b instanceof Error) throw b;
    if (b) return b;
    if (!buffers.has(url)) buffers.set(url, MP4(buffers.size + 1));
    return buffers.get(url)!;
  });
  const probeDurationSec = vi.fn(async (buf: Buffer) => opts.durations?.get(buf) ?? 5.04);
  const putClip = vi.fn(async (key: string) => `https://d111.cloudfront.net/${key}`);
  const assertDurable = vi.fn(() => { if (opts.durable === false) throw new Error("S3_BUCKET is not configured"); });
  const audit = vi.fn(async () => {});
  const deps = { database, fetchClip, probeDurationSec, putClip, assertDurable, audit, now: () => new Date("2026-10-16T15:00:00.000Z") };
  return { deps, updates, fetchClip, probeDurationSec, putClip, audit };
}

const input = (clipUrls: string[], over: Record<string, unknown> = {}) => ({
  jobId: 2100001, clipUrls, source: "higgsfield-web" as const, model: "wan-3.0", note: "unlimited plan", ...over,
});
const ctx = { attachedBy: "admin:7" };

afterEach(() => { vi.unstubAllGlobals(); });

describe("attachExternalClips: success", () => {
  it("re-hosts every clip in beat order and CAS-attaches the job as assets_ready", async () => {
    const h = harness();
    const r = await attachExternalClips(input(urls(6)), ctx, h.deps);
    expect(r).toMatchObject({ ok: true, jobId: 2100001, clipCount: 6 });
    if (!r.ok) throw new Error("unreachable");
    expect(r.rehostedUrls).toHaveLength(6);
    // never the vendor URL as the clip URL
    for (const u of r.rehostedUrls) expect(u).not.toContain("higgsfield.example");
    expect(r.rehostedUrls[0]).toContain("b1");
    expect(r.rehostedUrls[5]).toContain("b6");
    expect(h.updates).toHaveLength(1);
    const { set, where } = h.updates[0];
    expect(set.status).toBe("assets_ready");
    expect(set.queueState).toBe("qa_pending");
    expect(JSON.parse(String(set.clipUrlsJson))).toEqual(r.rehostedUrls);
    expect(set.attempts).toBe(0);
    expect(set.error).toBeNull();
    const payload = JSON.parse(String(set.payload));
    // merged, never replaced
    expect(payload.topic).toBe("brake rotor");
    expect(payload.heroAssetId).toBe("ma_9d6743c4");
    expect(payload.storyboardBeats).toHaveLength(6);
    expect(payload.externalClips).toMatchObject({
      source: "higgsfield-web", model: "wan-3.0", note: "unlimited plan", attachedBy: "admin:7",
      attachedAt: "2026-10-16T15:00:00.000Z", originalUrls: urls(6),
    });
    // The CAS: the WHERE names every field the decision read.
    const q = new MySqlDialect().sqlToQuery(where as never);
    expect(q.sql).toContain("`reel_jobs`.`id` = ?");
    expect(q.sql).toContain("`reel_jobs`.`status` = ?");
    expect(q.sql).toContain("`reel_jobs`.`payload` = ?");
    expect(q.sql).toContain("`reel_jobs`.`clipUrlsJson` is null");
    expect(q.params).toContain("needs_regen");
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ actionType: "attach_external_clips", decision: "OK" }));
  });

  it("attaches to a queued job too", async () => {
    const h = harness({ row: job({ status: "queued" }) });
    const r = await attachExternalClips(input(urls(6)), ctx, h.deps);
    expect(r.ok).toBe(true);
  });

  it("keeps the AI disclosure true for the attached job under every provider pin", async () => {
    const h = harness();
    const r = await attachExternalClips(input(urls(6)), ctx, h.deps);
    expect(r.ok).toBe(true);
    const { set } = h.updates[0];
    const lineage = JSON.parse(String(set.payload)).shotLineage;
    for (const pin of ["higgsfield", "veo", "template_stock", "self_hosted", "", undefined]) {
      expect(shouldDiscloseAi(String(set.clipUrlsJson), pin, { shotLineage: lineage })).toBe(true);
    }
  });

  it("slots clips into generated beats only and keeps a local beat's resolved clip", async () => {
    const beats = [beat(1), beat(2, { source: "deterministic", cardLines: ["$89"] }), beat(3)];
    const existing = JSON.stringify([null, "https://d111.cloudfront.net/reel-cards/card-2.mp4", null]);
    const h = harness({ row: job({ beats, clipUrlsJson: existing }) });
    const r = await attachExternalClips(input(urls(2)), ctx, h.deps);
    expect(r).toMatchObject({ ok: true, clipCount: 2 });
    const clips = JSON.parse(String(h.updates[0].set.clipUrlsJson));
    expect(clips).toHaveLength(3);
    expect(clips[1]).toBe("https://d111.cloudfront.net/reel-cards/card-2.mp4");
    expect(clips[0]).toContain("b1");
    expect(clips[2]).toContain("b3");
  });
});

describe("attachExternalClips: refusals (never a throw, never a write)", () => {
  const refused = async (h: ReturnType<typeof harness>, r: Awaited<ReturnType<typeof attachExternalClips>>, pattern: RegExp) => {
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal).toMatch(new RegExp(pattern.source, "i"));
    expect(h.updates).toHaveLength(0);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ actionType: "attach_external_clips", decision: "REFUSED" }));
  };

  it("refuses a job that does not exist", async () => {
    const h = harness({ row: null });
    await refused(h, await attachExternalClips(input(urls(6)), ctx, h.deps), /not found/i);
  });

  it.each(["assembled", "posted", "assets_ready", "generating"])("refuses a job in status %s", async (status) => {
    const h = harness({ row: job({ status }) });
    await refused(h, await attachExternalClips(input(urls(6)), ctx, h.deps), new RegExp(`status ${status}`));
    expect(h.fetchClip).not.toHaveBeenCalled();
  });

  it("refuses 5 clips for 6 generated beats", async () => {
    const h = harness();
    await refused(h, await attachExternalClips(input(urls(5)), ctx, h.deps), /5 clips.*6 generated beats/);
    expect(h.fetchClip).not.toHaveBeenCalled();
  });

  it("refuses 6 clips for a 2-beat brief", async () => {
    const h = harness({ row: job({ beats: [beat(1), beat(2)] }) });
    await refused(h, await attachExternalClips(input(urls(6)), ctx, h.deps), /6 clips.*2 generated beats/);
  });

  it("refuses an http URL even when it is the last one, before any download", async () => {
    const h = harness();
    const list = [...urls(5), "http://cdn.higgsfield.example/u/abc/6.mp4"];
    await refused(h, await attachExternalClips(input(list), ctx, h.deps), /clip 6 is not an https URL/);
    expect(h.fetchClip).not.toHaveBeenCalled();
  });

  it("refuses when durable storage is not configured, before any download", async () => {
    const h = harness({ durable: false });
    await refused(h, await attachExternalClips(input(urls(6)), ctx, h.deps), /durable storage/i);
    expect(h.fetchClip).not.toHaveBeenCalled();
  });

  it("refuses when a download fails, with no re-host and no write", async () => {
    const bodies = new Map<string, Buffer | Error>([[vendor(3), new Error("fetch 403")]]);
    const h = harness({ bodies });
    await refused(h, await attachExternalClips(input(urls(6)), ctx, h.deps), /clip 3 download failed: fetch 403/);
    expect(h.putClip).not.toHaveBeenCalled();
  });

  it("refuses a body that is not an MP4 (no ftyp box)", async () => {
    const bodies = new Map<string, Buffer | Error>([[vendor(2), PNG]]);
    const h = harness({ bodies });
    await refused(h, await attachExternalClips(input(urls(6)), ctx, h.deps), /clip 2 is not an MP4/);
    expect(h.putClip).not.toHaveBeenCalled();
  });

  it.each([3.1, 3.99])("refuses a %s s clip (shorter than the 4 s beat)", async (sec) => {
    const short = MP4(99);
    const bodies = new Map<string, Buffer | Error>([[vendor(4), short]]);
    const h = harness({ bodies, durations: new Map([[short, sec]]) });
    await refused(h, await attachExternalClips(input(urls(6)), ctx, h.deps), new RegExp(`clip 4 is ${sec}s`));
    expect(h.putClip).not.toHaveBeenCalled();
  });

  it("refuses when the CAS claim loses", async () => {
    const h = harness({ affectedRows: 0 });
    const r = await attachExternalClips(input(urls(6)), ctx, h.deps);
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.refusal).toMatch(/job 2100001 changed under us/);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ decision: "REFUSED" }));
  });

  it("refuses a local beat that has no resolved clip yet", async () => {
    const beats = [beat(1), beat(2, { source: "deterministic", cardLines: ["$89"] }), beat(3)];
    const h = harness({ row: job({ beats }) });
    await refused(h, await attachExternalClips(input(urls(2)), ctx, h.deps), /beat 2 .*no resolved clip/);
  });

  it("refuses a 61 MB body through the real bounded fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 200, headers: { "content-length": String(61 * 1024 * 1024) } })));
    const h = harness();
    const { fetchClip: _ignored, ...rest } = h.deps;
    await refused(h, await attachExternalClips(input(urls(6)), ctx, rest), /clip 1 download failed: .*too large/);
  });
});
