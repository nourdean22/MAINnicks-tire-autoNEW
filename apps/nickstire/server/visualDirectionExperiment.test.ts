/**
 * visual_direction_v1 — the one experiment the pack lane can run (2026-10-08).
 *
 * 06-EXPERIMENTS.md's mission experiment #3 (documentary vs cinematic camera)
 * needs no new content: an approved pack's lens is picked when the pack is
 * BUILT (approvedReelPackRotation.pickForPack), not authored. The arm narrows
 * that pick to one family. These tests pin the four links: the preset is a
 * clean design, the builder honours the arm on every rotation pack, the arm
 * reader resolves the same arm enqueue records, and the daily lane passes it.
 */
import { readFileSync } from "node:fs";
import { sliceBlock } from "./testUtils/sourceBlock";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, throwOnRead: false }));

// runningArmForEpisode reads: select().from().where().orderBy().limit(1).
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const fake = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              if (state.throwOnRead) throw new Error("db down");
              return state.rows;
            },
          }),
        }),
      }),
    }),
  };
  return { ...actual, getDb: async () => fake };
});

import { MOTION_LENSES } from "../client/src/lib/facelessReelStudio";
import { VISUAL_DIRECTION_LENSES, assignArm, buildExperimentPreset, findConfounds, isUnwiredExperimentId } from "../shared/contentExperiments";
import {
  APPROVED_REEL_PACK_SLUGS,
  APPROVED_REEL_PACKS,
  buildBriefFromApprovedProductionPack,
  loadApprovedProductionPack,
} from "./services/approvedReelPackRotation";
import { visualDirectionForEpisode } from "./services/contentExperimentStore";

const DOC = VISUAL_DIRECTION_LENSES.documentary as readonly string[];
const CINE = VISUAL_DIRECTION_LENSES.cinematic as readonly string[];

describe("the preset is a clean, wired design", () => {
  const def = buildExperimentPreset("visual_direction_v1", "2026-10-08T00:00:00Z");

  it("is wired, startable, and its arms differ on the camera direction only", () => {
    expect(def.wiring).toBe("wired");
    expect(isUnwiredExperimentId(def.experimentId)).toBe(false);
    expect(def.primaryVariable).toBe("visual_direction");
    expect(def.arms.map((a) => a.variantValue)).toEqual(["documentary", "cinematic"]);
    expect(findConfounds(def)).toEqual([]);
  });

  it("every family lens is a real lens, the families are disjoint, and both are photographic", () => {
    for (const lens of [...DOC, ...CINE]) expect(Object.keys(MOTION_LENSES), lens).toContain(lens);
    expect(DOC.filter((l) => CINE.includes(l))).toEqual([]);
    for (const stylised of ["claymation_stop_motion", "neon_retro_futurist", "anthropomorphized_object", "optical_illusion_morph", "surreal_scale"]) {
      expect([...DOC, ...CINE], stylised).not.toContain(stylised);
    }
  });
});

describe("the pack builder honours the arm on every rotation pack", () => {
  const build = (slug: string, direction?: "documentary" | "cinematic") => {
    const pack = APPROVED_REEL_PACKS.find((p) => p.slug === slug)!;
    const snapshot = loadApprovedProductionPack(slug)!;
    return buildBriefFromApprovedProductionPack(pack, snapshot, `daily-${slug}`, true, direction) as {
      motionLens: string;
      concepts: Array<{ motionLens: string }>;
    } | null;
  };

  it("documentary and cinematic arms draw only their family; the concept agrees with the brief", () => {
    let built = 0;
    for (const slug of APPROVED_REEL_PACK_SLUGS) {
      const doc = build(slug, "documentary");
      const cine = build(slug, "cinematic");
      if (!doc || !cine) continue;
      built++;
      expect(DOC, slug).toContain(doc.motionLens);
      expect(CINE, slug).toContain(cine.motionLens);
      if (doc.concepts?.length) expect(doc.concepts[0].motionLens, slug).toBe(doc.motionLens);
    }
    expect(built).toBe(APPROVED_REEL_PACK_SLUGS.length);
  });

  it("CONTROL: with no arm (the default), the pick is unchanged and reaches lenses outside both families", () => {
    const outside = APPROVED_REEL_PACK_SLUGS
      .map((slug) => build(slug))
      .filter((b): b is NonNullable<typeof b> => !!b)
      .filter((b) => !DOC.includes(b.motionLens) && !CINE.includes(b.motionLens));
    expect(outside.length).toBeGreaterThan(30);
    // Omitting the arm and passing undefined are the same build.
    const slug = APPROVED_REEL_PACK_SLUGS[0];
    const pack = APPROVED_REEL_PACKS.find((p) => p.slug === slug)!;
    const omitted = buildBriefFromApprovedProductionPack(pack, loadApprovedProductionPack(slug)!, `daily-${slug}`, true) as { motionLens: string };
    expect(build(slug)!.motionLens).toBe(omitted.motionLens);
  });
});

describe("the arm reader resolves the arm enqueue records", () => {
  const def = buildExperimentPreset("visual_direction_v1", "2026-10-08T00:00:00Z");
  const runningRow = {
    experimentId: def.experimentId, primaryVariable: "visual_direction", objective: def.objective,
    primaryMetric: def.primaryMetric, armsJson: def.arms, startedAt: new Date("2026-10-08T00:00:00Z"),
  };
  beforeEach(() => { state.rows = []; state.throwOnRead = false; });

  it("returns the same family assignArm gives for the episode key", async () => {
    state.rows = [runningRow];
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const key = `daily-2026-10-${String(i).padStart(2, "0")}`;
      const resolved = await visualDirectionForEpisode(key);
      const drawn = assignArm(def, key);
      expect(resolved?.direction, key).toBe(drawn.variantValue);
      // The arm the brief is stamped with is the one enqueue will draw for this key.
      expect(resolved?.applied, key).toEqual({ experimentId: def.experimentId, armId: drawn.armId });
      seen.add(String(resolved?.direction));
    }
    expect(seen).toEqual(new Set(["documentary", "cinematic"]));
  });

  it("no running experiment, or an unreadable store, keeps the full lens pick (undefined)", async () => {
    expect(await visualDirectionForEpisode("daily-x")).toBeUndefined();
    state.rows = [runningRow];
    state.throwOnRead = true;
    expect(await visualDirectionForEpisode("daily-x")).toBeUndefined();
  });

  it("an arm naming no declared family is not guessed at", async () => {
    state.rows = [{ ...runningRow, armsJson: [{ armId: "a", variantValue: "noir" }, { armId: "b", variantValue: "pastel" }] }];
    expect(await visualDirectionForEpisode("daily-x")).toBeUndefined();
  });
});

describe("the daily lane passes the arm into the pack build", () => {
  const CRON = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");
  const packBranch = () =>
    sliceBlock(CRON, "const baseSnapshot = loadApprovedProductionPack(approvedPack.slug);", "prepared = { brief: packBrief", { label: "dailyReelPost pack branch" });

  it("resolves visualDirectionForEpisode(briefId) BEFORE the build, passes the family, and stamps the applied arm", () => {
    const b = packBranch();
    const read = b.indexOf("await visualDirectionForEpisode(briefId)");
    const build = b.indexOf("buildBriefFromApprovedProductionPack(approvedPack, snapshot, briefId, false, visual?.direction)");
    const stamp = b.indexOf("...(visual ? [visual.applied] : [])");
    expect(read).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(read);
    expect(stamp).toBeGreaterThan(build);
  });

  it("CONTROL: a build that drops the arm is caught", () => {
    const unwired = packBranch().replace(", false, visual?.direction)", ")");
    expect(unwired.includes("buildBriefFromApprovedProductionPack(approvedPack, snapshot, briefId, false, visual?.direction)")).toBe(false);
  });
});
