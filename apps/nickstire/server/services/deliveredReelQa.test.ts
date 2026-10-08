import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { delivery } = vi.hoisted(() => ({ delivery: { result: { ok: true, mediaUrl: "" } as { ok: boolean; mediaUrl?: string; error?: string } } }));
vi.mock("./metaSocial", () => ({ getMediaDeliveryUrl: async () => delivery.result }));

import { checkDeliveredReel, compareDelivered, probeFromFfprobeJson, runDeliveredReelQaPass, type MediaProbe } from "./deliveredReelQa";

const master: MediaProbe = { width: 1080, height: 1920, fps: 30, durationSec: 20.0, hasAudio: true };

describe("compareDelivered — pure", () => {
  it("an equivalent rendition passes", () => {
    expect(compareDelivered(master, { width: 720, height: 1280, fps: 30, durationSec: 20.03, hasAudio: true })).toEqual([]);
  });
  it("names every way the delivered copy can be worse", () => {
    const issues = compareDelivered(master, { width: 480, height: 640, fps: 15, durationSec: 12, hasAudio: false }, { maxFlashesPerSecond: 5, worstWindowStartSec: 2, fail: true, framesAnalysed: 300 });
    expect(issues.sort()).toEqual(["aspect_changed", "audio_lost", "below_720p", "duration_changed", "flash_on_delivered_copy", "low_frame_rate", "resolution_dropped"].sort());
  });
  it("with no readable master only the delivered-only rules run", () => {
    expect(compareDelivered(null, { width: 480, height: 640, fps: 30, durationSec: 5, hasAudio: false })).toEqual(["below_720p"]);
  });
});

describe("probeFromFfprobeJson", () => {
  it("reads video size, frame rate, duration and audio presence", () => {
    expect(probeFromFfprobeJson({
      streams: [{ codec_type: "video", width: 1080, height: 1920, avg_frame_rate: "30000/1001" }, { codec_type: "audio" }],
      format: { duration: "20.020000" },
    })).toEqual({ width: 1080, height: 1920, fps: 30000 / 1001, durationSec: 20.02, hasAudio: true });
  });
  it("no video stream is null, not a fake probe", () => {
    expect(probeFromFfprobeJson({ streams: [{ codec_type: "audio" }] })).toBeNull();
  });
});

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const hasTools = spawnSync(ffmpeg, ["-version"]).status === 0 && spawnSync(process.env.FFPROBE_PATH || "ffprobe", ["-version"]).status === 0;

describe.skipIf(!hasTools)("checkDeliveredReel — real ffprobe/ffmpeg on rendered files", () => {
  let dir: string | null = null;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null; });
  const render = (name: string, size: string, withAudio: boolean) => {
    const out = path.join(dir!, name);
    const args = ["-y", "-f", "lavfi", "-i", `color=c=gray:s=${size}:r=30:d=2`];
    if (withAudio) args.push("-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest");
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", out);
    expect(spawnSync(ffmpeg, args).status).toBe(0);
    return out;
  };

  it("a downscaled, silent delivered copy is reported with both issues", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "delivered-"));
    const m = render("master.mp4", "720x1280", true);
    delivery.result = { ok: true, mediaUrl: render("delivered.mp4", "360x640", false) };
    const v = await checkDeliveredReel({ igPostId: "1", mp4Url: m });
    expect(v.verdict).toBe("issues");
    expect(v.issues).toEqual(expect.arrayContaining(["below_720p", "resolution_dropped", "audio_lost"]));
  }, 60_000);

  it("an unreadable master still checks the delivered copy and says why", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "delivered-"));
    delivery.result = { ok: true, mediaUrl: render("delivered.mp4", "720x1280", false) };
    const v = await checkDeliveredReel({ igPostId: "1", mp4Url: path.join(dir, "gone.mp4") });
    expect(v.verdict).toBe("pass");
    expect(v.masterUnreadable).toBeTruthy();
  }, 60_000);
});

describe("checkDeliveredReel — no delivered URL", () => {
  it("is unmeasured with the Graph reason, never a pass", async () => {
    delivery.result = { ok: false, error: "Instagram not configured (need META_PAGE_ACCESS_TOKEN)" };
    const v = await checkDeliveredReel({ igPostId: "1", mp4Url: "/nope.mp4" });
    expect(v).toMatchObject({ verdict: "unmeasured", issues: [] });
    expect(v.reason).toContain("META_PAGE_ACCESS_TOKEN");
  });
});

describe("runDeliveredReelQaPass", () => {
  it("checks unchecked posted Reels up to the limit, retries unmeasured up to 3, and keeps updatedAt", async () => {
    delivery.result = { ok: false, error: "token missing" };
    const writes: string[] = [];
    const rows = [
      { id: 1, igPostId: "a", mp4Url: "/m1.mp4", payload: JSON.stringify({ deliveredQa: { verdict: "pass", issues: [] } }) },
      { id: 2, igPostId: "b", mp4Url: "/m2.mp4", payload: JSON.stringify({ deliveredQa: { verdict: "unmeasured", issues: [], attempts: 3 } }) },
      { id: 3, igPostId: "c", mp4Url: "/m3.mp4", payload: JSON.stringify({ deliveredQa: { verdict: "unmeasured", issues: [], attempts: 1 } }) },
      { id: 4, igPostId: "d", mp4Url: "/m4.mp4", payload: "{}" },
      { id: 5, igPostId: "e", mp4Url: "/m5.mp4", payload: "{}" },
    ];
    const db: Parameters<typeof runDeliveredReelQaPass>[0] = {
      execute: async (q) => {
        const text = JSON.stringify(q);
        if (text.includes("SELECT id, igPostId")) return [rows];
        writes.push(text);
        return [{ affectedRows: 1 }];
      },
    };
    const summary = await runDeliveredReelQaPass(db, 2);
    expect(summary.checked).toBe(2);
    expect(summary.jobs).toEqual(["3:unmeasured", "4:unmeasured"]);
    expect(writes).toHaveLength(2);
    for (const w of writes) expect(w).toContain("updatedAt = updatedAt");
    expect(writes[0]).toContain('\\"attempts\\":2');
  });
});
