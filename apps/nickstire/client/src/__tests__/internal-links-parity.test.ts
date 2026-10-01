/**
 * Parity canary: `shared/linkGraph.ts` mirrors the hrefs rendered site-wide by
 * `client/src/components/InternalLinks.tsx` (a shared module cannot import a
 * React component). If someone adds or removes a link in the component and
 * not the mirror, inbound counts in the recommender silently drift — this
 * test is what makes the mirror honest. Source-string check by design: the
 * subject IS the two lists agreeing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SITEWIDE_COMPONENT_LINKS } from "@shared/linkGraph";
import { sliceBlock } from "../../../server/testUtils/sourceBlock";

describe("InternalLinks.tsx ↔ SITEWIDE_COMPONENT_LINKS", () => {
  it("the component's href list equals the mirror (order-insensitive)", () => {
    const src = readFileSync(path.resolve(__dirname, "../components/InternalLinks.tsx"), "utf8");
    // sliceBlock throws when an anchor is gone, so a renamed function cannot
    // silently widen this region to EOF and pass on unrelated hrefs.
    const body = sliceBlock(src, "function buildAllLinks", "interface Props", { label: "InternalLinks.tsx" });
    const hrefs = Array.from(body.matchAll(/href:\s*"([^"]+)"/g)).map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(40);
    expect([...hrefs].sort()).toEqual([...SITEWIDE_COMPONENT_LINKS].sort());
  });
});
