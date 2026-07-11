import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInsideRoot } from "@/lib/knowledge/path-safety";

describe("knowledge source path safety", () => {
  const root = path.resolve("/tmp/statenour/research-packs/test-pack");

  it("accepts a relative file inside the approved root", () => {
    expect(resolveInsideRoot(root, "notebooklm-output/findings.md")).toBe(
      path.join(root, "notebooklm-output", "findings.md"),
    );
  });

  it("accepts an absolute path only when it remains inside the root", () => {
    const file = path.join(root, "03_CLAIMS.md");
    expect(resolveInsideRoot(root, file)).toBe(file);
  });

  it("rejects parent traversal", () => {
    expect(() => resolveInsideRoot(root, "../../.env")).toThrow("Path escapes approved root");
  });

  it("rejects absolute paths outside the approved root", () => {
    expect(() => resolveInsideRoot(root, path.resolve("/tmp/secret.txt"))).toThrow(
      "Path escapes approved root",
    );
  });

  it("rejects sibling-prefix paths", () => {
    expect(() => resolveInsideRoot(root, `${root}-evil/manifest.json`)).toThrow(
      "Path escapes approved root",
    );
  });
});
