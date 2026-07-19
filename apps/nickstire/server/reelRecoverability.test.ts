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

/**
 * `status` was accepted by classifyRecoverability and never read — a parameter
 * that looked like a guard and guarded nothing.
 *
 * The harm was concrete: thirty seconds into `generating` a job has no master and
 * no clips, which by reachability alone is indistinguishable from total media
 * loss. The classifier fell through to `hasBrief` and offered "Spend and
 * regenerate" on a job that was actively rendering — so one tap bought a second
 * render of the same brief, and the superseded job kept running, wrote itself
 * back to assets_ready -> assembled, and was published by the daily cron.
 */
describe("an in-flight job is never offered a second paid render", () => {
  const IN_FLIGHT = ["queued", "generating", "assets_ready", "assembling", "repair_rendering"];

  it.each(IN_FLIGHT)("withholds regenerate while the job is '%s'", (status) => {
    // The exact mid-render shape: brief present, nothing written yet.
    const a = classifyRecoverability(base({ status, master: none, clips: [] }));
    expect(ids(a)).not.toContain("regenerate_new_job");
  });

  it("says WHY, so the missing button is not read as a broken screen", () => {
    const a = classifyRecoverability(base({ status: "generating" }));
    expect(a.explanation).toMatch(/still working|in flight/i);
    expect(a.explanation).toMatch(/cannot be cancelled/i);
  });

  it("does not describe a normal mid-render job as lost media", () => {
    const a = classifyRecoverability(base({ status: "generating" }));
    expect(a.explanation).not.toMatch(/all media for this job is gone/i);
  });

  it.each(IN_FLIGHT)("still offers the FREE actions while '%s' — only spending is withheld", (status) => {
    const a = classifyRecoverability(base({ status, clips: [up("c1"), up("c2")], master: down("m") }));
    expect(ids(a)).toContain("reassemble");
    expect(ids(a)).toContain("discard");
  });

  it("withholds regenerate even when the provider holds a resumable job", () => {
    const a = classifyRecoverability(base({ status: "generating", providerResumeId: "hf_123" }));
    expect(ids(a)).toContain("resume_generation");
    expect(ids(a)).not.toContain("regenerate_new_job");
  });

  it.each(["failed", "assembled", "archived", "rejected"])("OFFERS regenerate once the job is settled ('%s')", (status) => {
    const a = classifyRecoverability(base({ status }));
    expect(ids(a)).toContain("regenerate_new_job");
  });
});

describe("REGENERABLE_STATUSES is an allowlist, and that is the point", () => {
  it("treats an UNKNOWN future status as in-flight, not as safe to spend on", async () => {
    // The defect this replaces was a three-status denylist: any status added
    // later was permitted by omission. Under an allowlist a new status is
    // withheld until someone decides it is safe — the failure direction that
    // costs nothing instead of the one that pays twice.
    const { isRegenerable } = await import("./services/reelRecoverability");
    expect(isRegenerable("some_status_invented_next_year")).toBe(false);
    expect(isRegenerable(null)).toBe(false);
    expect(isRegenerable(undefined)).toBe(false);
  });

  it("never permits regenerating a job that may be live", async () => {
    const { isRegenerable } = await import("./services/reelRecoverability");
    for (const s of ["publishing", "publish_ambiguous", "posted"]) {
      expect(isRegenerable(s)).toBe(false);
    }
  });
});
