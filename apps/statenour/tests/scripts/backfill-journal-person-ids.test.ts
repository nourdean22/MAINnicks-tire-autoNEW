/**
 * W8b · scripts/backfill-journal-person-ids.ts never writes without --execute AND JOURNAL_PERSON_IDS_EXECUTE=1.
 *
 * prod-db-guard: a dry-run flag is not a guard until a non-executing read proves it returns before the write. The
 * script's declarations run here with an injected prisma whose writer is a spy; the dry run and the refused execute
 * must leave it uncalled, and the refused execute must exit 2 BEFORE prisma is even required.
 */
import { describe, expect, it, vi } from "vitest";
import { loadDecls } from "./fixtures/script-decls";

const FILE = "scripts/backfill-journal-person-ids.ts";
const people = [
  { id: "p_dania", name: "Dania" },
  { id: "p_mo", name: "Mo" },
  { id: "p_x", name: "X" }, // one char: never a key
];
const dumps = [
  { id: "d1", rawThoughts: "Talked to dania about the move." },
  { id: "d2", rawThoughts: "Mohammed called; Motown later." },
  { id: "d3", rawThoughts: "Nothing about anyone." },
];
const reflections = [{ id: "r1", insight: "Mo and Dania both came by." }];

function run(
  argv: string[],
  env: Record<string, string> = {},
  files: Record<string, string> = {},
  counts: { dumpCount: number; reflCount: number } = { dumpCount: 1, reflCount: 1 },
) {
  const dumpUpdate = vi.fn().mockResolvedValue({});
  const reflUpdate = vi.fn().mockResolvedValue({});
  const dumpUpdateMany = vi.fn().mockResolvedValue({ count: counts.dumpCount });
  const reflUpdateMany = vi.fn().mockResolvedValue({ count: counts.reflCount });
  const writeFile = vi.fn();
  const prisma = {
    personProfile: { findMany: vi.fn().mockResolvedValue(people) },
    brainDump: { findMany: vi.fn().mockResolvedValue(dumps), update: dumpUpdate, updateMany: dumpUpdateMany },
    reflection: { findMany: vi.fn().mockResolvedValue(reflections), update: reflUpdate, updateMany: reflUpdateMany },
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
    if (id === "@/lib/services/people/backfill-plan") {
      return {
        nameMatcher: (name: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${name.trim()}(?![\\p{L}\\p{N}_])`, "iu"),
      };
    }
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
  const { main } = loadDecls(FILE, ["EXECUTE_ENV", "MANIFEST_FILE", "parseArgs", "planPersonIds", "main"], {
    process: proc,
    console: { log: (s: string) => logs.push(String(s)), error: (s: string) => logs.push(String(s)) },
    require: requireFn,
  });
  const out = { requireFn, dumpUpdate, reflUpdate, dumpUpdateMany, reflUpdateMany, writeFile, prisma, logs };
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

  it("--execute with the env flag stamps ids only: whole-word, case-insensitive, no ledger rows, no model", async () => {
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
    expect(r.writeFile).toHaveBeenCalledTimes(1);
    const [path, body] = r.writeFile.mock.calls[0] as [string, string];
    expect(path).toMatch(/backfill-journal-person-ids\.applied\.json$/);
    expect(JSON.parse(body)).toEqual([
      { table: "brain_dumps", id: "d1", personIds: ["p_dania"] },
      { table: "reflections", id: "r1", personIds: ["p_dania", "p_mo"] },
    ]);
  });

  it("a row the live link stamped between the read and the write (count 0) is skipped and left out of the manifest", async () => {
    const r = await run(["--execute"], { JOURNAL_PERSON_IDS_EXECUTE: "1" }, {}, { dumpCount: 0, reflCount: 1 });
    expect(r.logs.join("\n")).toMatch(/written=1 skipped_already_linked=1 failed=0/);
    expect(JSON.parse(r.writeFile.mock.calls[0][1] as string).map((m: { id: string }) => m.id)).toEqual(["r1"]);
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
    expect(r.prisma.personProfile.findMany.mock.invocationCallOrder[0]).toBeGreaterThan(0);
    expect((await run([], {})).logs[0]).toBe("database host: unknown (DATABASE_URL unset or unparseable)");
  });

  it("--limit must be a positive integer", async () => {
    expect((await run(["--limit", "0"])).code).toBe(2);
    expect((await run(["--limit", "abc"])).code).toBe(2);
  });
});
