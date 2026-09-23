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
    // The three FREE, READ-ONLY Drive tools — and nothing else. Notably not
    // `syncDriveMemory`, which is side-effecting and spendy.
    expect(driveish.sort()).toEqual([
      "listRecentDriveFiles",
      "readDriveFile",
      "searchDriveFiles",
    ]);
  });
});

/**
 * The boundary has to hold through EVERY family, not just the one I narrowed.
 *
 * Review: "read the PDF in my Google Drive" still surfaced
 * `ingestDocumentFromUrl`, because the separate document family matched `pdf`
 * and added every `/ingestDocument/` tool. My original prompts never contained
 * `pdf`, `document` or `spreadsheet`, so the tests could not see it.
 *
 * Narrowing one matcher establishes nothing if a sibling matcher reopens the
 * same hole — and the catalog was under-flagging the tool, so the flag-driven
 * assertion above could not catch it either.
 */
describe("read-only boundary holds across families, not just the Drive one", () => {
  it("the catalog now flags the ingest tool for what it does", async () => {
    // tools/system.ts:292-299 — "fetches an arbitrary URL + parses + embeds ->
    // real paid cost", with a daily quota guard. It was `cost: "cheap"` with no
    // sideEffecting flag, which made every flag-reading guard blind to it.
    const t = TOOL_CATALOG.find((x) => (x as { name: string }).name === "ingestDocumentFromUrl") as
      | { sideEffecting?: boolean; cost?: string }
      | undefined;
    expect(t?.sideEffecting).toBe(true);
    expect(t?.cost).toBe("spendy");
  });

  it.each([
    "read the PDF in my Google Drive",
    "open that spreadsheet from my drive",
    "find the document in gdrive about the lease",
  ])("CANARY: no paid ingest tool for the READ request: %s", async (prompt) => {
    const offered = await offeredFor(prompt);
    expect(
      offered,
      `"${prompt}" surfaced the paid ingest tool through the document family`,
    ).not.toContain("ingestDocumentFromUrl");
    expect(offered.filter((n) => SPENDY_SIDE_EFFECTING.includes(n))).toEqual([]);
  });

  it("POSITIVE CONTROL: an explicit INGEST request still gets the ingest tool", async () => {
    // Without this, removing the tool everywhere would satisfy the canary and
    // quietly delete a capability rather than scoping it.
    const offered = await offeredFor("ingest this pdf into my documents");
    expect(offered).toContain("ingestDocumentFromUrl");
  });

  it("a read-shaped document request still reaches searchDocuments", async () => {
    const offered = await offeredFor("search my documents for the lease");
    expect(offered).toContain("searchDocuments");
  });

  it("CANARY: the recent-files Drive tool is reachable again", async () => {
    // It is free and read-only, and the only tool that answers this phrasing.
    // The first cut of the anchored allowlist dropped it.
    const offered = await offeredFor("what's new in my google drive?");
    expect(offered).toContain("listRecentDriveFiles");
  });
});
