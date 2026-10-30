/**
 * Pack keys are `wisdom_<pack>_<array index>` (scripts/ingest-wisdom-pack.ts).
 * That is what lets a reload overwrite the live rows in place, and also why a
 * reordered or inserted entry would silently rewrite a different row's text
 * under an old key. Packs are append-only: this snapshot pins the text behind
 * every index. Appending entries adds lines; any other change fails here.
 * Changing an entry's wording on purpose: update the snapshot in the same PR.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../data/wisdom");

describe("wisdom pack keys are stable", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();

  it("finds the packs (a scan over nothing would pass)", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)("%s: the text behind each index is unchanged", (file) => {
    const pack = JSON.parse(readFileSync(resolve(DIR, file), "utf8")) as { pack: string; entries: { text: string }[] };
    const keys = pack.entries.map(
      (e, i) => `wisdom_${pack.pack}_${String(i).padStart(3, "0")} ${createHash("sha256").update(e.text).digest("hex").slice(0, 12)}`,
    );
    expect(keys).toMatchSnapshot();
  });
});
