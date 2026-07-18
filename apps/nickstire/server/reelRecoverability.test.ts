/**
 * classifyRecoverability — actions must follow MEASURED artifact survival, not status.
 *
 * Grounded in a real production finding: three reel jobs sat in status "assembled"
 * for two days, and every one of their mp4Urls returned 404 because
 * data/generated is on the container's ephemeral disk. An action center built on
 * status alone would have offered Repair / Publish on empty jobs.
 */
import { describe, it, expect } from "vitest";
import { classifyRecoverability, type RecoverabilityInput } from "./services/reelRecoverability";

const up = (url: string) => ({ url, reachable: true });
const down = (url: string) => ({ url, reachable: false });
const none = { url: null, reachable: false };

const base = (over: Partial<RecoverabilityInput> = {}): RecoverabilityInput => ({
  status: "assembled",
  master: none,
  clips: [],
  hasBrief: true,
  ...over,
});

const ids = (a: ReturnType<typeof classifyRecoverability>) => a.actions.map((x) => x.id);

describe("master_available", () => {
  it("offers publish and re-QA when the master really resolves", () => {
    const a = classifyRecoverability(base({ master: up("https://cdn/reel.mp4") }));
    expect(a.recoverability).toBe("master_available");
    expect(ids(a)).toContain("publish");
    expect(ids(a)).toContain("rerun_qa");
  });

  it("a non-null but UNREACHABLE mp4Url is not a master — the exact prod case", () => {
    // reel 660002: status "assembled", mp4Url set, HTTP 404.
    const a = classifyRecoverability(base({ master: down("https://nickstire.org/generated/reel-660002.mp4") }));
    expect(a.recoverability).not.toBe("master_available");
    expect(ids(a)).not.toContain("publish");
    expect(a.danglingUrls).toContain("https://nickstire.org/generated/reel-660002.mp4");
  });
});

describe("clips_available_master_missing", () => {
  it("offers a free re-assemble when every clip survives", () => {
    const a = classifyRecoverability(base({ master: down("https://cdn/reel.mp4"), clips: [up("c1"), up("c2")] }));
    expect(a.recoverability).toBe("clips_available_master_missing");
    const reassemble = a.actions.find((x) => x.id === "reassemble")!;
    expect(reassemble.costsMoney).toBe(false);
    // Re-assembly still yields a different file, so approval cannot carry over.
    expect(reassemble.newAssetIdentity).toBe(true);
  });

  it("PARTIAL clip survival does NOT count — a shorter reel is not the approved one", () => {
    const a = classifyRecoverability(base({ master: down("m"), clips: [up("c1"), down("c2")] }));
    expect(a.recoverability).toBe("brief_only");
    expect(ids(a)).not.toContain("reassemble");
  });

  it("an empty clip list is not 'all clips reachable'", () => {
    const a = classifyRecoverability(base({ master: down("m"), clips: [] }));
    expect(a.recoverability).toBe("brief_only");
  });
});

describe("provider_resume_available", () => {
  it("prefers resuming already-paid provider output over regenerating", () => {
    const a = classifyRecoverability(base({ master: down("m"), clips: [down("c1")], providerResumeId: "hf_job_1" }));
    expect(a.recoverability).toBe("provider_resume_available");
    expect(a.actions.find((x) => x.id === "resume_generation")!.costsMoney).toBe(false);
  });
});

describe("brief_only — the three stuck production jobs", () => {
  const stuck = base({ master: down("https://nickstire.org/generated/reel-600001.mp4"), clips: [], hasBrief: true });

  it("offers regenerate / archive / discard and nothing else", () => {
    const a = classifyRecoverability(stuck);
    expect(a.recoverability).toBe("brief_only");
    expect(ids(a)).toEqual(["regenerate_new_job", "archive_unrecoverable", "discard"]);
  });

  it("never offers repair, re-QA or publish on media that does not exist", () => {
    const a = classifyRecoverability(stuck);
    for (const forbidden of ["publish", "rerun_qa", "reassemble", "resume_generation"]) {
      expect(ids(a)).not.toContain(forbidden);
    }
  });

  it("labels regeneration as PAID and as a NEW asset identity, never as a repair", () => {
    const regen = classifyRecoverability(stuck).actions.find((x) => x.id === "regenerate_new_job")!;
    expect(regen.costsMoney).toBe(true);
    expect(regen.newAssetIdentity).toBe(true);
    expect(regen.label).not.toMatch(/repair/i);
    expect(regen.detail).toMatch(/not a repair/i);
  });
});

describe("unrecoverable", () => {
  it("with no media and no brief, only archive/discard remain", () => {
    const a = classifyRecoverability(base({ master: down("m"), hasBrief: false }));
    expect(a.recoverability).toBe("unrecoverable");
    expect(ids(a)).toEqual(["archive_unrecoverable", "discard"]);
  });
});

describe("dangling URL reporting", () => {
  it("lists every artifact the record points at that no longer resolves", () => {
    const a = classifyRecoverability(
      base({ master: down("m.mp4"), clips: [down("c1.mp4"), up("c2.mp4")], voiceover: down("vo.mp3"), music: up("bg.mp3") }),
    );
    expect(a.danglingUrls.sort()).toEqual(["c1.mp4", "m.mp4", "vo.mp3"]);
  });

  it("does not report artifacts that were never recorded", () => {
    const a = classifyRecoverability(base({ master: none, clips: [] }));
    expect(a.danglingUrls).toEqual([]);
  });
});
