/**
 * The comment stripper backs security assertions elsewhere in this suite, and
 * it had no tests of its own — which is how it shipped eating URLs.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { readCode } from "../testUtils/sourceAssertions";

/** readCode resolves from cwd, so hand it a cwd-relative path. */
function codeOf(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "srcassert-"));
  const file = join(dir, "sample.ts");
  writeFileSync(file, source, "utf8");
  return readCode(relative(process.cwd(), file));
}

describe("readCode", () => {
  // THE BUG: `//` inside a URL read as a line comment and deleted the rest of
  // the line. Any negative assertion about that line then passed vacuously.
  it("does NOT treat // inside a string literal as a comment", () => {
    const out = codeOf('const url = "https://oauth2.googleapis.com/token";\nconst keep = 1;');
    expect(out).toContain("https://oauth2.googleapis.com/token");
    expect(out).toContain("const keep = 1");
  });

  it("keeps code that follows a URL on the same line", () => {
    const out = codeOf('fetch("https://x.com/a", { signal: AbortSignal.timeout(20) });');
    expect(out).toMatch(/AbortSignal\.timeout\(20\)/);
  });

  it("still strips real line comments", () => {
    const out = codeOf("const a = 1; // this is prose about forbiddenToken\nconst b = 2;");
    expect(out).not.toContain("forbiddenToken");
    expect(out).toContain("const a = 1;");
    expect(out).toContain("const b = 2;");
  });

  it("still strips block comments", () => {
    const out = codeOf("/* prose mentioning forbiddenToken */\nconst a = 1;");
    expect(out).not.toContain("forbiddenToken");
    expect(out).toContain("const a = 1;");
  });

  it("handles // inside single quotes and template literals", () => {
    const out = codeOf("const a = 'http://a.test/x';\nconst b = `ws://b.test/y`;");
    expect(out).toContain("http://a.test/x");
    expect(out).toContain("ws://b.test/y");
  });

  it("respects escaped quotes inside strings", () => {
    const out = codeOf('const s = "a \\" // not a comment";\nconst after = 1;');
    expect(out).toContain("// not a comment");
    expect(out).toContain("const after = 1");
  });

  it("preserves newlines so line-anchored patterns still work", () => {
    const out = codeOf("const a = 1;\n// gone\nconst b = 2;");
    expect(out.split("\n").length).toBe(3);
  });

  // Regression guard for the real file that exposed this.
  it("finds the bounded token fetch in gsc-data.ts", () => {
    const code = readCode("server/pipelines/gsc-data.ts");
    expect(code).toContain("oauth2.googleapis.com/token");
  });
});
