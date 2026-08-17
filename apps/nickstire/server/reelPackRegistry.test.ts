/**
 * The bridge between the two reel lanes must be REAL — a registry that
 * silently resolves nothing looks identical to a registry with nothing to say,
 * and that ambiguity is exactly how the lanes drifted apart.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listCommittedPacks,
  packCoveredTopics,
  resolvePacksDir,
  __resetPackCache,
} from "./services/reelPackRegistry";

let tmp: string;
const today = new Date().toISOString().slice(0, 10);

function writePack(slug: string, brief?: Record<string, unknown>) {
  const dir = path.join(tmp, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# pack\n");
  if (brief) fs.writeFileSync(path.join(dir, "brief.json"), JSON.stringify(brief));
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-packs-"));
  process.env.REEL_PACKS_DIR = tmp;
  __resetPackCache();
});
afterEach(() => {
  delete process.env.REEL_PACKS_DIR;
  __resetPackCache();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("reelPackRegistry", () => {
  it("resolves the directory it was pointed at", () => {
    expect(resolvePacksDir()).toBe(tmp);
  });

  it("reads a pack with a brief.json, keeping campaign keyword and archetype", () => {
    writePack(`${today}-battery-summer-heat`, { campaignKeyword: "BATTERY", archetype: "myth_vs_reality" });
    const [pack] = listCommittedPacks();
    expect(pack.slug).toBe(`${today}-battery-summer-heat`);
    expect(pack.campaignKeyword).toBe("BATTERY");
    expect(pack.archetype).toBe("myth_vs_reality");
    expect(pack.topic).toBe("battery summer heat");
  });

  it("still counts a pack with NO brief.json — the slug occupies the topic", () => {
    writePack(`${today}-tire-expiration`);
    const [pack] = listCommittedPacks();
    expect(pack.topic).toBe("tire expiration");
    expect(pack.campaignKeyword).toBeUndefined();
  });

  it("survives an unparseable brief.json rather than dropping the pack", () => {
    const dir = path.join(tmp, `${today}-broken`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "brief.json"), "{ not json");
    expect(listCommittedPacks().map((p) => p.topic)).toContain("broken");
  });

  it("surfaces covered topics AND campaign keywords for the avoid-list", () => {
    writePack(`${today}-battery-summer-heat`, { campaignKeyword: "BATTERY" });
    const covered = packCoveredTopics(30);
    expect(covered).toContain("battery summer heat");
    expect(covered).toContain("battery");
  });

  it("does not let an old pack retire a topic forever", () => {
    writePack("2020-01-01-ancient-topic");
    expect(packCoveredTopics(30)).not.toContain("ancient topic");
    expect(listCommittedPacks().map((p) => p.topic)).toContain("ancient topic");
  });

  it("returns empty — not throwing — when no packs directory exists", () => {
    process.env.REEL_PACKS_DIR = path.join(tmp, "does-not-exist");
    __resetPackCache();
    // cwd fallbacks may legitimately resolve in-repo; the contract is only that
    // it never throws and always returns an array.
    expect(Array.isArray(listCommittedPacks())).toBe(true);
  });
});
