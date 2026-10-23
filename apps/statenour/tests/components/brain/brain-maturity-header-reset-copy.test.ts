/**
 * The Reset confirm text must say what Reset does (2026-10-23, lens B finding 4).
 * resetBrainState deletes BrainMemory rows only; the header's contradictions counter reads the
 * contradictions TABLE, which Reset never touches. The copy used to say Reset "clears ...
 * contradictions".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "components/brain/brain-maturity-header.tsx"), "utf8");
const body = /body: "(This clears[^"]*)"/.exec(src)?.[1] ?? "";

describe("Reset confirm copy", () => {
  it("control: the confirm body is found", () => {
    expect(body).toContain("CANNOT be undone");
  });

  it("does not promise to clear contradictions, and says the claim-vs-record list is untouched", () => {
    const cleared = body.split("The claim-vs-record")[0];
    expect(cleared).not.toMatch(/contradictions/i);
    expect(body).toMatch(/claim-vs-record[^.]*(not touched|untouched)/i);
  });
});
