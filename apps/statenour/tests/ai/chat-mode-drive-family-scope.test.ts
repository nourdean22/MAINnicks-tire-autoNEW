/**
 * A READ request about Drive or documents must not surface a spendy write tool.
 *
 * History: #2388 shipped a Drive family whose pattern also matched
 * `syncDriveMemory` (`sideEffecting: true, cost: "spendy"`) and
 * `ingestDocumentFromUrl`, so a read intent surfaced a bulk ingest. That is an
 * authority question, not a budget one. The Drive family and its three read tools
 * were removed 2026-10-18; this file keeps the boundary canaries that still hold
 * through the document family.
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

describe("Drive prompts · pruner sanity", () => {
  it("POSITIVE CONTROL: the pruner returns a bounded, non-empty set", async () => {
    const offered = await offeredFor("what are my tasks today");
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThan(TOOL_CATALOG.length);
  });

  it("the catalog really does mark syncDriveMemory spendy + side-effecting", async () => {
    // If this ever stops being true the canaries below assert nothing, so
    // prove the premise rather than trusting the name.
    expect(SPENDY_SIDE_EFFECTING).toContain("syncDriveMemory");
  });

  it("CANARY: a plain Drive request does NOT surface the spendy ingest tool", async () => {
    const offered = await offeredFor("search my google drive for the lease");
    expect(
      offered.filter((n) => SPENDY_SIDE_EFFECTING.includes(n)),
      "a read intent put a spendy side-effecting tool in front of the model",
    ).toEqual([]);
    expect(offered).not.toContain("ingestDocumentFromUrl");
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
});
