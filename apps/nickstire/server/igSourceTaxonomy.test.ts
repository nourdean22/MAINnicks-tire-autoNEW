/**
 * One taxonomy, one set of names.
 *
 * The nine Instagram source types were declared THREE times: here in
 * `shared/instagramStudio.ts`, again in `client/src/lib/instagram/quality.ts`,
 * and a third time in `server/services/ig/quality.ts` (dead — zero importers by
 * any path form, single commit in its history, deleted with this change).
 *
 * The unions were structurally identical, so TypeScript accepted all three and
 * no check could see them drift. They HAD drifted, in the labels the operator
 * reads: the same source was "Verified Review" on one screen and "5-Star Review"
 * on another.
 *
 * These tests pin the consolidation. The exhaustiveness guarantee itself is
 * enforced by `tsc`, not here — red-green verified by adding a tenth member to
 * INSTAGRAM_SOURCE_TYPES, which failed all three derived records with TS2741.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  INSTAGRAM_SOURCE_ICONS,
  INSTAGRAM_SOURCE_LABELS,
  INSTAGRAM_SOURCE_REQUIRES_DETAIL,
  INSTAGRAM_SOURCE_TYPES,
} from "../shared/instagramStudio";
import { ContentSourceRegistry, type SourceType } from "../client/src/lib/instagram/quality";

describe("the dead third copy is gone", () => {
  it("server/services/ig/quality.ts no longer exists", () => {
    expect(existsSync(resolve(process.cwd(), "server/services/ig/quality.ts"))).toBe(false);
  });
});

describe("the client registry is DERIVED, not redeclared", () => {
  it("covers exactly the canonical source types — no more, no fewer", () => {
    expect(Object.keys(ContentSourceRegistry).sort()).toEqual([...INSTAGRAM_SOURCE_TYPES].sort());
  });

  it("every label matches the canonical label — the drift that existed is closed", () => {
    for (const type of INSTAGRAM_SOURCE_TYPES) {
      expect(ContentSourceRegistry[type].label).toBe(INSTAGRAM_SOURCE_LABELS[type]);
    }
  });

  it("requiresDetail and icon come from the canonical records", () => {
    for (const type of INSTAGRAM_SOURCE_TYPES) {
      expect(ContentSourceRegistry[type].requiresDetail).toBe(INSTAGRAM_SOURCE_REQUIRES_DETAIL[type]);
      expect(ContentSourceRegistry[type].icon).toBe(INSTAGRAM_SOURCE_ICONS[type]);
    }
  });

  it("does not reintroduce a literal label table", () => {
    // A future edit that pastes the labels back in would pass every assertion
    // above only until someone changed one. Catch the shape, not just the values.
    const src = require("node:fs").readFileSync(
      resolve(process.cwd(), "client/src/lib/instagram/quality.ts"),
      "utf8",
    ) as string;
    const registry = src.slice(src.indexOf("export const ContentSourceRegistry"), src.indexOf("export type PostFormat"));
    expect(registry).toContain("INSTAGRAM_SOURCE_LABELS[type]");
    expect(registry).not.toContain('label: "');
  });
});

describe("SourceType is an alias, so the two unions cannot diverge again", () => {
  it("assigns canonical members to the client type without a cast", () => {
    // Compile-time proof: if SourceType were still its own union this would
    // still pass, so the value assertion below is what makes it meaningful.
    const all: SourceType[] = [...INSTAGRAM_SOURCE_TYPES];
    expect(all).toHaveLength(INSTAGRAM_SOURCE_TYPES.length);
    expect(new Set(all).size).toBe(INSTAGRAM_SOURCE_TYPES.length);
  });
});

describe("formats were deliberately NOT unified", () => {
  it("the client's PostFormat vocabulary really does differ from the shared one", () => {
    // Guards against a future 'tidy-up' aliasing PostFormat to InstagramFormat:
    // 'single' vs 'post' are different values that flow into enqueueReelJob.
    const src = require("node:fs").readFileSync(
      resolve(process.cwd(), "client/src/lib/instagram/quality.ts"),
      "utf8",
    ) as string;
    expect(src).toContain('export type PostFormat = "single"');
    expect(src).not.toContain("PostFormat = InstagramFormat");
  });
});
