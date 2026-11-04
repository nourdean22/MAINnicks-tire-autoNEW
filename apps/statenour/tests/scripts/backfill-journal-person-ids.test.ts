/**
 * W8b · scripts/backfill-journal-person-ids.ts never writes without --execute AND JOURNAL_PERSON_IDS_EXECUTE=1.
 *
 * prod-db-guard: a dry-run flag is not a guard until a non-executing read proves it returns before the write. The
 * script's declarations run here with an injected prisma whose writer is a spy; the dry run and the refused execute
 * must leave it uncalled, and the refused execute must exit 2 BEFORE prisma is even required.
 */
import { describe, expect, it, vi } from "vitest";
import * as backfillPlan from "@/lib/services/people/backfill-plan";
import { loadDecls } from "./fixtures/script-decls";

const FILE = "scripts/backfill-journal-person-ids.ts";
const people = [
  { id: "p_dania", name: "Dania" },
  { id: "p_mo", name: "Mo" },
  { id: "p_x", name: "X" }, // one char: never a key
];
const dumps = [
  { id: "d1", rawThoughts: "Talked to Dania about the move." },
  { id: "d2", rawThoughts: "Mohammed called; Motown later." },
  { id: "d3", rawThoughts: "Nothing about anyone." },
];
const reflections = [{ id: "r1", insight: "Saw Mo and Dania both." }];

function run(
  argv: string[],
  env: Record<string, string> = {},
  files: Record<string, string> = {},
  counts: { dumpCount: number; reflCount: number } = { dumpCount: 1, reflCount: 1 },
  data: { people?: typeof people; dumps?: typeof dumps; reflections?: typeof reflections; dumpWrite?: ReturnType<typeof vi.fn> } = {},
) {
  const dumpUpdate = vi.fn().mockResolvedValue({});
  const reflUpdate = vi.fn().mockResolvedValue({});
  const dumpUpdateMany = data.dumpWrite ?? vi.fn().mockResolvedValue({ count: counts.dumpCount });
  const reflUpdateMany = vi.fn().mockResolvedValue({ count: counts.reflCount });
  const writeFile = vi.fn();
  let logsAtFirstRead: string[] | null = null;
  const prisma = {
    personProfile: {
      findMany: vi.fn(async () => {
        logsAtFirstRead ??= [...logs];
        return data.people ?? people;
      }),
    },
    brainDump: { findMany: vi.fn().mockResolvedValue(data.dumps ?? dumps), update: dumpUpdate, updateMany: dumpUpdateMany },
    reflection: { findMany: vi.fn().mockResolvedValue(data.reflections ?? reflections), update: reflUpdate, updateMany: reflUpdateMany },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const requireFn = vi.fn((id: string) => {
    if (id === "@/lib/prisma") return { prisma };
    if (id === "node:fs") {
      return {
        writeFileSync: writeFile,
        readFileSync: (p: string) => {
          if (!(p in files)) throw new Error(`ENOENT ${p}`);
          return files[p];
        },
      };
    }
    if (id === "@/lib/services/people/backfill-plan") return backfillPlan;
    throw new Error(`unexpected require ${id}`);
  });
  const logs: string[] = [];
  const proc = {
    argv: ["node", FILE, ...argv],
    env,
    exit(code?: number): never {
      throw { exited: code ?? 0 };
    },
  };
  const { main } = loadDecls(FILE, ["EXECUTE_ENV", "MANIFEST_FILE", "parseArgs", "main"], {
    process: proc,
    console: { log: (s: string) => logs.push(String(s)), error: (s: string) => logs.push(String(s)) },
    require: requireFn,
  });
  const out = {
    requireFn,
    dumpUpdate,
    reflUpdate,
    dumpUpdateMany,
    reflUpdateMany,
    writeFile,
    prisma,
    logs,
    get logsAtFirstRead() {
      return logsAtFirstRead;
    },
  };
  return main(argv).then(
    () => ({ code: "returned" as const, ...out }),
    (e: { exited?: unknown }) => ({ code: e.exited, ...out }),
  );
}

describe("backfill-journal-person-ids", () => {
  it("dry run (default): reads, prints counts, returns before any write", async () => {
    const r = await run([]);
    expect(r.code).toBe("returned");
    expect(r.dumpUpdate).not.toHaveBeenCalled();
    expect(r.reflUpdate).not.toHaveBeenCalled();
    expect(r.dumpUpdateMany).not.toHaveBeenCalled();
    expect(r.reflUpdateMany).not.toHaveBeenCalled();
    expect(r.logs.join("\n")).toMatch(/brain_dumps: scanned=3 to_stamp=1 people_named=1/);
    expect(r.logs.join("\n")).toMatch(/reflections: scanned=1 to_stamp=1 people_named=2/);
    expect(r.logs.join("\n")).toMatch(/dry run: nothing written/);
    // Never a name in the output.
    expect(r.logs.join("\n")).not.toMatch(/Dania|Mo\b/);
  });

  it("--execute without the env flag exits 2 before prisma is required", async () => {
    const r = await run(["--execute"]);
    expect(r.code).toBe(2);
    expect(r.requireFn).not.toHaveBeenCalledWith("@/lib/prisma");
    expect(r.dumpUpdate).not.toHaveBeenCalled();
  });

  it("--execute with the env flag stamps ids only: whole-word, case-sensitive, no ledger rows, no model", async () => {
    const r = await run(["--execute"], { JOURNAL_PERSON_IDS_EXECUTE: "1" });
    expect(r.code).toBe("returned");
    // Compare-and-swap on the still-empty column: a row the live link stamped since the read is left alone.
    expect(r.dumpUpdateMany).toHaveBeenCalledTimes(1);
    expect(r.dumpUpdateMany).toHaveBeenCalledWith({ where: { id: "d1", personIds: { isEmpty: true } }, data: { personIds: ["p_dania"] } });
    expect(r.reflUpdateMany).toHaveBeenCalledWith({ where: { id: "r1", personIds: { isEmpty: true } }, data: { personIds: ["p_dania", "p_mo"] } });
    expect(Object.keys(r.prisma)).not.toContain("relationshipLedger");
    expect(r.prisma.brainDump.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null, personIds: { isEmpty: true } });
  });

  it("--execute writes a manifest of exactly what it stamped (table, id, ids), so the run can be reverted", async () => {
    const r = await run(["--execute"], { JOURNAL_PERSON_IDS_EXECUTE: "1" });
    const [path, body] = r.writeFile.mock.calls.at(-1) as [string, string];
    expect(path).toMatch(/backfill-journal-person-ids\.applied\.json$/);
    expect(JSON.parse(body)).toEqual([
      { table: "brain_dumps", id: "d1", personIds: ["p_dania"] },
      { table: "reflections", id: "r1", personIds: ["p_dania", "p_mo"] },
    ]);
  });

  it("a row the live link stamped between the read and the write (count 0) is skipped and left out of the manifest", async () => {
    const r = await run(["--execute"], { JOURNAL_PERSON_IDS_EXECUTE: "1" }, {}, { dumpCount: 0, reflCount: 1 });
    expect(r.logs.join("\n")).toMatch(/written=1 skipped_already_linked=1 failed=0/);
    expect(JSON.parse(r.writeFile.mock.calls.at(-1)![1] as string).map((m: { id: string }) => m.id)).toEqual(["r1"]);
  });

  // Manager round 1, item 3: a crash mid-loop used to leave stamped rows with no revert record.
  it("writes the planned manifest BEFORE the first stamp, naming every planned row", async () => {
    const r = await run(["--execute"], { JOURNAL_PERSON_IDS_EXECUTE: "1" });
    expect(JSON.parse(r.writeFile.mock.calls[0][1] as string)).toEqual([
      { table: "brain_dumps", id: "d1", personIds: ["p_dania"] },
      { table: "reflections", id: "r1", personIds: ["p_dania", "p_mo"] },
    ]);
    expect(r.writeFile.mock.invocationCallOrder[0]).toBeLessThan(r.dumpUpdateMany.mock.invocationCallOrder[0]);
  });

  it("a write that throws stays in the manifest (it may have landed), and revert restores only rows that hold the stamp", async () => {
    const five = ["a", "b", "c", "d", "e"].map((id) => ({ id, rawThoughts: "saw Dania today" }));
    const dumpWrite = vi.fn().mockResolvedValue({ count: 1 }).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error("connection reset"));
    const r = await run(["--execute"], { JOURNAL_PERSON_IDS_EXECUTE: "1" }, {}, undefined, { dumps: five, reflections: [], dumpWrite });
    expect(r.code).toBe(1);
    const planned = r.writeFile.mock.calls[0][1] as string;
    expect(JSON.parse(planned).map((m: { id: string }) => m.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(JSON.parse(r.writeFile.mock.calls.at(-1)![1] as string).map((m: { id: string }) => m.id)).toEqual(["a", "b", "c", "d", "e"]);
    // The process dying after write 2 leaves the planned file: revert clears what holds the stamp and keeps the rest.
    const crashed = vi.fn().mockResolvedValue({ count: 0 }).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    const back = await run(["--revert", "m.json"], { JOURNAL_PERSON_IDS_EXECUTE: "1" }, { "m.json": planned }, undefined, { dumpWrite: crashed });
    expect(back.logs.join("\n")).toMatch(/reverted=2 kept=3/);
  });

  // Manager round 1, items 2 + 8: the same rule as the save-time link, before this runs over the old entries.
  it("stamps by the shared rule: case-sensitive, not at a sentence start, no namesakes, counted never named", async () => {
    const r = await run(["--execute"], { JOURNAL_PERSON_IDS_EXECUTE: "1" }, {}, undefined, {
      people: [
        { id: "p_will", name: "Will" },
        { id: "p_sam1", name: "Sam" },
        { id: "p_sam2", name: "Sam" },
        { id: "p_ali1", name: "Ali" },
        { id: "p_ali2", name: "ALI" },
      ],
      dumps: [
        { id: "d1", rawThoughts: "I will call the shop." },
        { id: "d2", rawThoughts: "Will called about the invoice." },
        { id: "d3", rawThoughts: "talked to Will today" },
        { id: "d4", rawThoughts: "talked to Sam today" },
        { id: "d5", rawThoughts: "saw Ali at the shop" },
      ],
      reflections: [],
    });
    expect(r.dumpUpdateMany).toHaveBeenCalledTimes(1);
    expect(r.dumpUpdateMany).toHaveBeenCalledWith({ where: { id: "d3", personIds: { isEmpty: true } }, data: { personIds: ["p_will"] } });
    expect(r.logs.join("\n")).toMatch(/ambiguous=2/);
    expect(r.logs.join("\n")).not.toMatch(/Sam|Ali/);
  });

  it("the dry run writes no manifest", async () => {
    const r = await run([]);
    expect(r.writeFile).not.toHaveBeenCalled();
  });

  it("--revert clears only rows that still hold exactly what was stamped (compare-and-swap); a row the live link changed is kept", async () => {
    const manifest = JSON.stringify([
      { table: "brain_dumps", id: "d1", personIds: ["p_dania"] },
      { table: "reflections", id: "r1", personIds: ["p_dania", "p_mo"] },
    ]);
    const r = await run(["--revert", "m.json"], { JOURNAL_PERSON_IDS_EXECUTE: "1" }, { "m.json": manifest }, { dumpCount: 1, reflCount: 0 });
    expect(r.code).toBe("returned");
    expect(r.dumpUpdateMany).toHaveBeenCalledWith({ where: { id: "d1", personIds: { equals: ["p_dania"] } }, data: { personIds: [] } });
    expect(r.reflUpdateMany).toHaveBeenCalledWith({ where: { id: "r1", personIds: { equals: ["p_dania", "p_mo"] } }, data: { personIds: [] } });
    expect(r.logs.join("\n")).toMatch(/reverted=1 kept=1/);
    expect(r.dumpUpdate).not.toHaveBeenCalled();
  });

  it("--revert without the env flag exits 2 before prisma is required", async () => {
    const r = await run(["--revert", "m.json"], {}, { "m.json": "[]" });
    expect(r.code).toBe(2);
    expect(r.requireFn).not.toHaveBeenCalledWith("@/lib/prisma");
  });

  // prod-db-guard step 4: say which database before reading or writing (every worktree's .env points at prod).
  it("prints the database host, never the credentials, before any read", async () => {
    const r = await run([], { DATABASE_URL: "postgresql://user:s3cret@ep-demo-123.us-east-2.aws.neon.tech/neondb?sslmode=require" });
    const out = r.logs.join("\n");
    expect(r.logs[0]).toBe("database host: ep-demo-123.us-east-2.aws.neon.tech");
    expect(out).not.toMatch(/s3cret|user:/);
    // Before any read: the host line was already logged when the first database read ran.
    expect(r.logsAtFirstRead).toEqual(["database host: ep-demo-123.us-east-2.aws.neon.tech"]);
    expect((await run([], {})).logs[0]).toBe("database host: unknown (DATABASE_URL unset or unparseable)");
  });

  it("--limit must be a positive integer", async () => {
    expect((await run(["--limit", "0"])).code).toBe(2);
    expect((await run(["--limit", "abc"])).code).toBe(2);
  });
});
