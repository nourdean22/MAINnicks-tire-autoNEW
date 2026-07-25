import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BRIDGE_IGNORE_MARKER, dirHasIgnoreMarker } from "./ignore";

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-ignore-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("the bridge ignore contract", () => {
  it("a folder with the marker declares itself non-inbox", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, BRIDGE_IGNORE_MARKER), "machine export — not bridge inbox\n");
    expect(dirHasIgnoreMarker(dir)).toBe(true);
  });

  it("an ordinary folder is inbox content", () => {
    expect(dirHasIgnoreMarker(tmpDir())).toBe(false);
  });

  it("a missing folder is not ignored (and does not throw)", () => {
    expect(dirHasIgnoreMarker(path.join(os.tmpdir(), "bridge-ignore-does-not-exist"))).toBe(false);
  });
});

describe("every bridge scanner honors the marker (source pins)", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

  it("ingest walk() returns [] for marked folders — no quarantine, no knowledge-gate feed", () => {
    const s = read("scripts/ingest-obsidian-candidates.ts");
    expect(s).toMatch(/if \(dirHasIgnoreMarker\(root\)\) return \[\];/);
  });

  it("doctor getFilesRecursive() skips marked folders — no validation, no --fix rewriting", () => {
    const s = read("scripts/obsidian-doctor.ts");
    expect(s).toMatch(/if \(dirHasIgnoreMarker\(dir\)\) return results;/);
  });

  it("the watcher does not trigger engine runs for events inside marked folders", () => {
    const s = read("scripts/obsidian-engine-runner.ts");
    expect(s).toMatch(/dirHasIgnoreMarker\(path\.join\(watchedPath, topSegment\)\)/);
  });
});
