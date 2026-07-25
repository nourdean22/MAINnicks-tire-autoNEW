import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFrontmatter,
  buildNoteContent,
  calculateHash,
  hasIdenticalNewestConflict,
  planNoteWrite,
  pruneConflictDir,
} from "./note-writer";

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "note-writer-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const META = { title: "Brain Memories Rollup: REFERENCE", type: "memory_rollup", source: "statenour" };
const CRLF_BODY = "# 🧠 Brain Memories: REFERENCE\n\n## Key: a\n\n```\nline one\r\nline two\r\n```\n";

/** A file exactly as the pre-fix exporter wrote it: hash over the RAW body, CRs included. */
function legacyFile(metadata: Record<string, any>, body: string): string {
  const fullMetadata = { ...metadata, hash: calculateHash(body.trim()), last_synced_at: "2026-07-08T13:21:20.428Z" };
  return buildFrontmatter(fullMetadata) + body;
}

describe("export/read hash parity (the 1,870-conflict bug)", () => {
  it("a body containing CRLF converges: second export skips instead of conflicting", () => {
    const first = planNoteWrite(null, META, CRLF_BODY);
    expect(first.kind).toBe("write");
    const onDisk = (first as { content: string }).content;

    const second = planNoteWrite(onDisk, META, CRLF_BODY, new Date("2026-07-26T00:00:00Z"));
    expect(second.kind).toBe("skip");
  });

  it("a legacy CR-era file (raw-body hash) is recognized as pristine and heals, not conflicts", () => {
    const legacy = legacyFile(META, CRLF_BODY);
    const plan = planNoteWrite(legacy, META, CRLF_BODY);
    expect(plan.kind).toBe("write"); // heal: rewrite with the canonical normalized hash

    const healed = (plan as { content: string }).content;
    expect(healed).not.toContain("\r");
    const next = planNoteWrite(healed, META, CRLF_BODY, new Date("2026-07-26T00:00:00Z"));
    expect(next.kind).toBe("skip");
  });

  it("a genuine local edit still raises a conflict and never overwrites the note", () => {
    const written = (planNoteWrite(null, META, CRLF_BODY) as { content: string }).content;
    const edited = written + "\nMy own Obsidian note.\n";
    const plan = planNoteWrite(edited, META, CRLF_BODY);
    expect(plan.kind).toBe("conflict");
  });

  it("a real body change rewrites; only last_synced_at drift does not", () => {
    const written = (planNoteWrite(null, META, CRLF_BODY) as { content: string }).content;
    expect(planNoteWrite(written, META, CRLF_BODY + "\n## Key: b\n").kind).toBe("write");
    expect(planNoteWrite(written, META, CRLF_BODY, new Date("2027-01-01T00:00:00Z")).kind).toBe("skip");
  });

  it("preserves a locally-set review_due when rewriting", () => {
    const withReview = buildFrontmatter({ ...META, hash: calculateHash("old body"), review_due: "2026-08-01" }) + "old body";
    const plan = planNoteWrite(withReview, META, "new body");
    expect(plan.kind).toBe("write");
    expect((plan as { content: string }).content).toContain('review_due: "2026-08-01"');
  });
});

describe("conflict copy dedup", () => {
  it("detects that the newest staged conflict already carries this content", () => {
    const dir = tmpDir();
    const { content } = buildNoteContent(META, CRLF_BODY, new Date("2026-07-25T13:00:00Z"));
    fs.writeFileSync(path.join(dir, "Brain Memories Rollup REFERENCE.conflict-20260725130000.md"), content, "utf-8");

    const { content: again } = buildNoteContent(META, CRLF_BODY, new Date("2026-07-25T14:00:00Z"));
    expect(hasIdenticalNewestConflict(dir, "Brain Memories Rollup REFERENCE", again)).toBe(true);

    const { content: changed } = buildNoteContent(META, CRLF_BODY + "extra", new Date("2026-07-25T14:00:00Z"));
    expect(hasIdenticalNewestConflict(dir, "Brain Memories Rollup REFERENCE", changed)).toBe(false);
  });

  it("returns false for an empty or missing conflict dir", () => {
    expect(hasIdenticalNewestConflict(path.join(os.tmpdir(), "note-writer-none"), "X", "content")).toBe(false);
    expect(hasIdenticalNewestConflict(tmpDir(), "X", "content")).toBe(false);
  });
});

describe("conflict retention", () => {
  it("keeps only the newest N copies per note title", () => {
    const dir = tmpDir();
    for (let i = 1; i <= 15; i++) {
      fs.writeFileSync(path.join(dir, `Note A.conflict-202607${String(i).padStart(2, "0")}120000.md`), "a", "utf-8");
    }
    for (let i = 1; i <= 3; i++) {
      fs.writeFileSync(path.join(dir, `Note B.conflict-202607${String(i).padStart(2, "0")}120000.md`), "b", "utf-8");
    }
    fs.writeFileSync(path.join(dir, "unrelated.md"), "not a conflict file", "utf-8");

    const result = pruneConflictDir(dir, 10);
    expect(result.deleted).toBe(5);
    expect(result.kept).toBe(13);

    const remaining = fs.readdirSync(dir).sort();
    expect(remaining).toContain("unrelated.md");
    expect(remaining.filter(f => f.startsWith("Note A"))).toHaveLength(10);
    expect(remaining.filter(f => f.startsWith("Note B"))).toHaveLength(3);
    // the oldest five of Note A are the ones gone
    expect(remaining).not.toContain("Note A.conflict-20260701120000.md");
    expect(remaining).not.toContain("Note A.conflict-20260705120000.md");
    expect(remaining).toContain("Note A.conflict-20260706120000.md");
    expect(remaining).toContain("Note A.conflict-20260715120000.md");
  });

  it("is a no-op on a missing dir", () => {
    expect(pruneConflictDir(path.join(os.tmpdir(), "note-writer-missing"))).toEqual({ deleted: 0, kept: 0 });
  });
});
