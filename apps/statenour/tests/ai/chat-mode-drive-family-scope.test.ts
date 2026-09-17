/**
 * The Drive family must offer Drive READS, and only for Google Drive.
 *
 * Two defects shipped in #2388 and were caught by review the next day. Both are
 * about a family being WIDER than the capability it represents:
 *
 *   1 · the trigger accepted `dropbox` and a generic `cloud storage`, while no
 *       Dropbox connector exists anywhere in the app — so the model was handed
 *       Google Drive tools for a datastore it cannot reach;
 *   2 · `addMatching(/drive|document/i)` also matched `syncDriveMemory`, which
 *       the catalog marks `sideEffecting: true, cost: "spendy"`, plus
 *       `ingestDocumentFromUrl`. A READ intent was surfacing a bulk ingest.
 *
 * The second is the one that matters: surfacing a spendy write tool on a read
 * request is an authority question, not a budget one.
 */
import { describe, it, expect } from "vitest";
import { pruneTools } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

function allTools(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of TOOL_CATALOG) out[(t as { name: string }).name] = {};
  return out;
}
const offeredFor = async (prompt: string) =>
  Object.keys((await pruneTools("standard" as never, allTools(), prompt)) as Record<string, unknown>);

/** Read from the catalog, so the test cannot drift from the real flags. */
const SPENDY_SIDE_EFFECTING = TOOL_CATALOG.filter(
  (t) => (t as { sideEffecting?: boolean }).sideEffecting && (t as { cost?: string }).cost === "spendy",
).map((t) => (t as { name: string }).name);

describe("Google Drive family · scoped to real, read-only capability", () => {
  it("POSITIVE CONTROL: the pruner returns a bounded, non-empty set", async () => {
    const offered = await offeredFor("what are my tasks today");
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThan(TOOL_CATALOG.length);
  });

  it("the catalog really does mark syncDriveMemory spendy + side-effecting", async () => {
    // If this ever stops being true the test below is asserting nothing, so
    // prove the premise rather than trusting the name.
    expect(SPENDY_SIDE_EFFECTING).toContain("syncDriveMemory");
  });

  it.each([
    "search my google drive for the lease",
    "find the invoice in my drive",
    "look in gdrive for the tax return",
  ])("still surfaces the Drive READ tools for: %s", async (prompt) => {
    const offered = await offeredFor(prompt);
    expect(offered, `"${prompt}" no longer reaches searchDriveFiles`).toContain("searchDriveFiles");
  });

  it("CANARY: a Drive READ request does NOT surface the spendy ingest tool", async () => {
    const offered = await offeredFor("search my google drive for the lease");
    expect(
      offered.filter((n) => SPENDY_SIDE_EFFECTING.includes(n)),
      "a read intent put a spendy side-effecting tool in front of the model",
    ).toEqual([]);
    expect(offered).not.toContain("ingestDocumentFromUrl");
  });

  it("CANARY: Dropbox does not surface Google Drive tools", async () => {
    // There is no Dropbox connector. Offering Drive tools here is answering a
    // question about one datastore with another — worse than offering nothing.
    const offered = await offeredFor("search my dropbox for the lease");
    expect(offered).not.toContain("searchDriveFiles");
    expect(offered).not.toContain("readDriveFile");
  });

  it("the family cannot silently acquire a new member", async () => {
    // Anchored `^(...)$` rather than a substring, so adding a tool whose name
    // merely contains "drive" does not join this family by accident — which is
    // exactly how syncDriveMemory got in.
    const offered = await offeredFor("search my google drive for the lease");
    const driveish = offered.filter((n) => /drive/i.test(n));
    expect(driveish.sort()).toEqual(["readDriveFile", "searchDriveFiles"]);
  });
});
