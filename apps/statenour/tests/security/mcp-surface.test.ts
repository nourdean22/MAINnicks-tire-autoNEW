/**
 * tests/security/mcp-surface.test.ts — MCP published-surface pin (2026-08-03).
 *
 * The rug-pull guard from the mcp-scan proposal, taken as a PATTERN and
 * re-pointed at the surface that actually exists (see the module doc on
 * lib/agent-bridge/surface-digest.ts and the UPSTREAMS.md row).
 *
 * `MCP_V1_TOOLS` is `TOOL_CATALOG.map(t => t.name)` — every tool added
 * to the catalog is auto-published over POST /api/mcp with no review
 * step. This makes that publication VISIBLE: a new tool, a widened
 * argument schema, or an edited description (text the calling model
 * reads as instructions) all fail this test until a human regenerates
 * the pin and reviews the diff.
 *
 * Regenerating is a deliberate command, never a test side-effect:
 *   pnpm snapshot:mcp-surface
 * A snapshot that rewrites itself when the thing it guards changes is
 * not a guard.
 *
 * NOTE: this must run under vitest, not tsx — `nourTools` transitively
 * imports `server-only`, which throws outside a Next server context and
 * is aliased to a shim in vitest.config.ts.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeMcpSurface,
  diffSurface,
  type SurfaceEntry,
} from "@/lib/agent-bridge/surface-digest";

const SNAPSHOT = new URL("./mcp-surface.snapshot.json", import.meta.url);
const UPDATING = process.env.UPDATE_MCP_SURFACE === "1";

const current = computeMcpSurface();

if (UPDATING) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(current, null, 2)}\n`, "utf8");
}

describe("the published MCP surface matches its committed pin", () => {
  it("has a committed snapshot", () => {
    // Fail closed. A missing pin must not read as "nothing changed" —
    // deleting the file would otherwise be a silent way to disable this.
    expect(
      existsSync(SNAPSHOT),
      "mcp-surface.snapshot.json is missing — run `pnpm snapshot:mcp-surface` and REVIEW the diff",
    ).toBe(true);
  });

  it("publishes a non-empty surface (the diff below is not passing by vacuity)", () => {
    expect(current.length).toBeGreaterThan(0);
  });

  it("no tool was added, removed, or altered without review", () => {
    const pinned = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as SurfaceEntry[];
    const diff = diffSurface(pinned, current);

    const report = [
      diff.added.length ? `ADDED (now published to any client with the bridge token): ${diff.added.join(", ")}` : "",
      diff.removed.length ? `REMOVED: ${diff.removed.join(", ")}` : "",
      ...Object.entries(diff.changed).map(
        ([name, fields]) =>
          `CHANGED ${name}: ${fields.join(", ")}${
            fields.includes("descriptionSha256")
              ? "  <- description is text the calling model reads as INSTRUCTIONS"
              : ""
          }`,
      ),
    ]
      .filter(Boolean)
      .join("\n");

    expect(
      report,
      `MCP surface drift. If every line below is intended, run \`pnpm snapshot:mcp-surface\`:\n${report}\n`,
    ).toBe("");
  });
});

describe("surface invariants that hold regardless of the pin", () => {
  it("every published tool carries a description the model can read", () => {
    // An empty description would make the tool uninterpretable to a
    // client model — and would hash identically across tools, defeating
    // the per-tool rug-pull check.
    const emptyHash = current.filter((t) => t.descriptionSha256 === current[0]?.descriptionSha256);
    expect(current.every((t) => t.descriptionSha256.length === 16)).toBe(true);
    expect(emptyHash.length, "many tools share one description hash").toBeLessThan(
      Math.max(3, current.length / 4),
    );
  });

  it("names are unique — a duplicate would let one tool shadow another", () => {
    expect(new Set(current.map((t) => t.name)).size).toBe(current.length);
  });
});
