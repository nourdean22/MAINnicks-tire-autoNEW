/**
 * Rendered QA judges a reel's environment against the world its clips were
 * actually prompted with (job 2100002, 2026-10-17). A job whose clips were
 * attached from outside the pipeline (payload.externalClips) with the attach
 * attesting startFrame "none" was not given the shop photograph as a start
 * frame, so "the opening frame of every shot IS this photo" cannot be true of
 * it; the critic gets the lens world instead. An attach attesting "shop_still",
 * a record with no attestation, and anything the pipeline may have
 * image-conditioned keep the shop world.
 *
 * The critic is a fake behind the invokeLLM seam: it behaves like the live one
 * did (drift on every frame when the prompt demands the shop photo and the
 * frames show the lens world), so a wrong prompt turns the verdict red.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

afterEach(() => {
  vi.doUnmock("./_core/llm");
  vi.resetModules();
});

const SHOP_INVARIANTS = "Real place: Nick's Tire & Auto. The opening frame of every shot IS this photo; keep the storefront, signage and lot.";
const SHOP_WORLD = { style: "real_shop_still", heroFrameUrl: "https://cdn.example/shop.jpg", framePrompt: "", lockedInvariants: SHOP_INVARIANTS };
const EXTERNAL = { source: "higgsfield-web", startFrame: "none", model: null, note: null, attachedBy: "operator", attachedAt: "2026-10-17T12:00:00.000Z", originalUrls: [] };
const EXT_CLIPS = [
  "https://cdn.example/reel-clips/higgsfield-external-2100002-b1-1760000000000-abc123.mp4",
  "https://cdn.example/reel-clips/higgsfield-external-2100002-b2-1760000000000-def456.mp4",
];
const PIPELINE_CLIPS = ["https://cdn.example/reel-clips/reel-2100002-b1.mp4", "https://cdn.example/reel-clips/reel-2100002-b2.mp4"];
/** What runRenderedQaOnJob hands the critic for an attached job: the record plus the clips in use. */
const attached = { externalClips: EXTERNAL, clipUrls: EXT_CLIPS };
const baseBrief = {
  topic: "see-through tire plug",
  objectCharacter: "tire",
  motionLens: "xray_cutaway",
  visualWorld: SHOP_WORLD,
  storyboardBeats: [{ beatNumber: 1, visual: "x-ray of a tire tread" }, { beatNumber: 2, visual: "x-ray of the plug path" }],
};

type Captured = { system: string };

/** Loads renderedQa behind a fake critic. `reply` decides the verdict from the system prompt. */
async function load(reply: (system: string) => unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-world-"));
  const fake = path.join(dir, "f.jpg");
  await fs.writeFile(fake, Buffer.from("fakejpegbytes"));
  const frames = [{ label: "first", beatNumber: 1, timestamp: 0, path: fake }, { label: "beat1", beatNumber: 1, timestamp: 1, path: fake }];
  const seen: Captured[] = [];
  vi.doMock("./_core/llm", () => ({
    invokeLLM: vi.fn().mockImplementation(async (req: { messages: Array<{ role: string; content: unknown }> }) => {
      const system = String(req.messages.find((m) => m.role === "system")?.content ?? "");
      seen.push({ system });
      return { choices: [{ message: { content: JSON.stringify(reply(system)) }, finish_reason: "stop" }] };
    }),
  }));
  vi.resetModules();
  const mod = await import("./services/renderedQa");
  return { evaluateRenderedReel: mod.evaluateRenderedReel, frames, seen };
}

const DRIFT = (beatNumber: number | null) => ({
  beatNumber, code: "ENVIRONMENT_DRIFT", description: "not the required opening photograph of Nick's Tire & Auto", preserve: [], change: [],
});
/** The live critic's behaviour: the shop-photo demand + lens-world frames = drift everywhere. */
const worldSensitiveCritic = (system: string) =>
  /IS this photo/.test(system) ? { decision: "repair", findings: [DRIFT(null), DRIFT(1)] } : { decision: "approve", findings: [] };
const blocks = (v: { findings: Array<{ code: string; severity: string }> }) => v.findings.filter((f) => f.severity === "block");

describe("rendered QA world follows the clips' conditioning", () => {
  it("text_only (external clips): the critic is given the lens world, not the shop photo, and the reel passes", async () => {
    const { evaluateRenderedReel, frames, seen } = await load(worldSensitiveCritic);
    const v = await evaluateRenderedReel({ frames, brief: { ...baseBrief, ...attached } });
    expect(seen[0].system).not.toMatch(/IS this photo|APPROVED VISUAL WORLD/);
    expect(seen[0].system).toMatch(/LENS WORLD/);
    expect(seen[0].system).toContain("clean dark field"); // xray_cutaway grammar
    expect(v.critic).toBe("vision");
    expect(blocks(v)).toEqual([]);
    expect(v.decision).toBe("approve");
  });

  it("CONTROL image-conditioned (pipeline clips, hero still): the shop world is demanded and drift still blocks", async () => {
    const { evaluateRenderedReel, frames, seen } = await load(worldSensitiveCritic);
    const v = await evaluateRenderedReel({ frames, brief: { ...baseBrief } });
    expect(seen[0].system).toMatch(/APPROVED VISUAL WORLD/);
    expect(seen[0].system).toContain("IS this photo");
    expect(v.decision).toBe("repair");
    expect(blocks(v).map((f) => f.code)).toEqual(["ENVIRONMENT_DRIFT", "ENVIRONMENT_DRIFT"]);
  });

  it("CONTROL no conditioning record (bare locked invariants): today's world block, fail closed", async () => {
    const { evaluateRenderedReel, frames, seen } = await load(worldSensitiveCritic);
    const brief = { ...baseBrief, visualWorld: { lockedInvariants: SHOP_INVARIANTS } };
    const v = await evaluateRenderedReel({ frames, brief });
    expect(seen[0].system).toContain(`APPROVED VISUAL WORLD (every frame must match):\n${SHOP_INVARIANTS}`);
    expect(v.decision).toBe("repair");
  });

  it("CONTROL a malformed record is no record: externalClips that is not an object keeps the shop world", async () => {
    const { evaluateRenderedReel, frames, seen } = await load(worldSensitiveCritic);
    for (const externalClips of [true, "yes", 1, [], null]) {
      const v = await evaluateRenderedReel({ frames, brief: { ...baseBrief, clipUrls: EXT_CLIPS, externalClips } });
      expect(v.decision).toBe("repair");
    }
    expect(seen.every((s) => /IS this photo/.test(s.system))).toBe(true);
  });

  it("CONTROL the attach attested the shop still as start frame: shop world, drift still blocks", async () => {
    const { evaluateRenderedReel, frames, seen } = await load(worldSensitiveCritic);
    const v = await evaluateRenderedReel({ frames, brief: { ...baseBrief, clipUrls: EXT_CLIPS, externalClips: { ...EXTERNAL, startFrame: "shop_still" } } });
    expect(seen[0].system).toContain("IS this photo");
    expect(seen[0].system).not.toMatch(/LENS WORLD/);
    expect(v.decision).toBe("repair");
  });

  it("CONTROL an unattested record (no startFrame, from before the field existed) keeps the shop world", async () => {
    const { evaluateRenderedReel, frames, seen } = await load(worldSensitiveCritic);
    const { startFrame: _dropped, ...legacy } = EXTERNAL;
    const v = await evaluateRenderedReel({ frames, brief: { ...baseBrief, clipUrls: EXT_CLIPS, externalClips: legacy } });
    expect(seen[0].system).toContain("IS this photo");
    expect(v.decision).toBe("repair");
  });

  it("CONTROL an invalid startFrame value keeps the shop world (only the exact string none attests text-only)", async () => {
    const { evaluateRenderedReel, frames, seen } = await load(worldSensitiveCritic);
    for (const startFrame of ["None", "NONE", " none", "text_only", "", null, true, 0, ["none"], { none: true }]) {
      const v = await evaluateRenderedReel({ frames, brief: { ...baseBrief, clipUrls: EXT_CLIPS, externalClips: { ...EXTERNAL, startFrame } } });
      expect(v.decision).toBe("repair");
    }
    expect(seen).toHaveLength(10);
    expect(seen.every((s) => /IS this photo/.test(s.system))).toBe(true);
  });

  it("CONTROL a pipeline repair after the attach may have used the hero still: shop world again", async () => {
    const { evaluateRenderedReel, frames, seen } = await load(worldSensitiveCritic);
    const queued = await evaluateRenderedReel({ frames, brief: { ...baseBrief, ...attached, repairQueue: [{ state: "queued" }] } });
    const done = await evaluateRenderedReel({ frames, brief: { ...baseBrief, ...attached, repairs: [{ beatNumber: 2 }] } });
    const garbled = await evaluateRenderedReel({ frames, brief: { ...baseBrief, ...attached, repairs: "x" } });
    expect([queued.decision, done.decision, garbled.decision]).toEqual(["repair", "repair", "repair"]);
    expect(seen.every((s) => /IS this photo/.test(s.system))).toBe(true);
  });

  it("CONTROL an empty repair record does not defeat the text_only world", async () => {
    const { evaluateRenderedReel, frames } = await load(worldSensitiveCritic);
    const v = await evaluateRenderedReel({ frames, brief: { ...baseBrief, ...attached, repairQueue: [], repairs: [] } });
    expect(v.decision).toBe("approve");
  });

  it("CONTROL a stale record: externalClips is on the payload but a regeneration replaced the clips with pipeline renders", async () => {
    const { evaluateRenderedReel, frames, seen } = await load(worldSensitiveCritic);
    const swapped = await evaluateRenderedReel({ frames, brief: { ...baseBrief, externalClips: EXTERNAL, clipUrls: PIPELINE_CLIPS } });
    const mixed = await evaluateRenderedReel({ frames, brief: { ...baseBrief, externalClips: EXTERNAL, clipUrls: [EXT_CLIPS[0], PIPELINE_CLIPS[1]] } });
    const none = await evaluateRenderedReel({ frames, brief: { ...baseBrief, externalClips: EXTERNAL } });
    const empty = await evaluateRenderedReel({ frames, brief: { ...baseBrief, externalClips: EXTERNAL, clipUrls: [] } });
    // the marker must open the file name: elsewhere in a pipeline clip's URL it proves nothing
    const lookalike = await evaluateRenderedReel({ frames, brief: { ...baseBrief, externalClips: EXTERNAL, clipUrls: PIPELINE_CLIPS.map((u) => `${u}?src=higgsfield-external-1`) } });
    expect([swapped.decision, mixed.decision, none.decision, empty.decision, lookalike.decision]).toEqual(["repair", "repair", "repair", "repair", "repair"]);
    expect(seen.every((s) => /IS this photo/.test(s.system))).toBe(true);
  });

  it("a drawn card or bound real beat keeps its own clip; only generated beats must carry the external marker", async () => {
    const { evaluateRenderedReel, frames } = await load(worldSensitiveCritic);
    const beats = [{ beatNumber: 1, visual: "x-ray of a tire tread" }, { beatNumber: 2, visual: "drawn card", source: "deterministic" }];
    const v = await evaluateRenderedReel({ frames, brief: { ...baseBrief, storyboardBeats: beats, externalClips: EXTERNAL, clipUrls: [EXT_CLIPS[0], "https://cdn.example/reel-clips/card-2.mp4"] } });
    expect(v.decision).toBe("approve");
  });

  it("CONTROL text_only with no known lens has no lens world to judge against: shop world", async () => {
    const { evaluateRenderedReel, frames, seen } = await load(worldSensitiveCritic);
    const none = await evaluateRenderedReel({ frames, brief: { ...baseBrief, ...attached, motionLens: undefined } });
    const odd = await evaluateRenderedReel({ frames, brief: { ...baseBrief, ...attached, motionLens: "constructor" } });
    expect([none.decision, odd.decision]).toEqual(["repair", "repair"]);
    expect(seen.every((s) => /IS this photo/.test(s.system))).toBe(true);
  });

  it("CANARY text_only: a jump between unrelated locations is still an ENVIRONMENT_DRIFT block", async () => {
    const jump = { decision: "repair", findings: [{ beatNumber: 3, code: "ENVIRONMENT_DRIFT", description: "beat 3 cuts from the x-ray field to a parking lot with no transition", preserve: [], change: [] }] };
    const { evaluateRenderedReel, frames, seen } = await load(() => jump);
    const v = await evaluateRenderedReel({ frames, brief: { ...baseBrief, ...attached } });
    expect(seen[0].system).toMatch(/LENS WORLD/);
    expect(v.decision).toBe("repair");
    expect(blocks(v).map((f) => `${f.code}@${f.beatNumber}`)).toEqual(["ENVIRONMENT_DRIFT@3"]);
  });

  it("text_only does not loosen any other check: a face still blocks", async () => {
    const human = { decision: "approve", findings: [{ beatNumber: 2, code: "HUMAN_PRESENT", description: "a face at the edge", preserve: [], change: [] }] };
    const { evaluateRenderedReel, frames } = await load(() => human);
    const v = await evaluateRenderedReel({ frames, brief: { ...baseBrief, ...attached } });
    expect(v.decision).toBe("repair");
    expect(blocks(v).map((f) => f.code)).toEqual(["HUMAN_PRESENT"]);
  });

  it("text_only on a brief with no visual world at all is unchanged: no world block, continuity stays evidence", async () => {
    const drift = { decision: "repair", findings: [DRIFT(2)] };
    const { evaluateRenderedReel, frames, seen } = await load(() => drift);
    const v = await evaluateRenderedReel({ frames, brief: { ...baseBrief, ...attached, visualWorld: undefined } });
    expect(seen[0].system).toContain("No approved visual world");
    expect(seen[0].system).not.toMatch(/LENS WORLD/);
    expect(blocks(v)).toEqual([]);
  });
});
