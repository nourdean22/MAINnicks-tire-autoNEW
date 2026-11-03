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

function run(argv: string[], env: Record<string, string> = {}) {
  const dumpUpdate = vi.fn().mockResolvedValue({});
  const reflUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    personProfile: { findMany: vi.fn().mockResolvedValue(people) },
    brainDump: { findMany: vi.fn().mockResolvedValue(dumps), update: dumpUpdate },
    reflection: { findMany: vi.fn().mockResolvedValue(reflections), update: reflUpdate },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const requireFn = vi.fn((id: string) => {
    if (id === "@/lib/prisma") return { prisma };
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
  const { main } = loadDecls(FILE, ["EXECUTE_ENV", "parseArgs", "planPersonIds", "main"], {
    process: proc,
    console: { log: (s: string) => logs.push(String(s)), error: (s: string) => logs.push(String(s)) },
    require: requireFn,
  });
  return main(argv).then(
    () => ({ code: "returned" as const, requireFn, dumpUpdate, reflUpdate, prisma, logs }),
    (e: { exited?: unknown }) => ({ code: e.exited, requireFn, dumpUpdate, reflUpdate, prisma, logs }),
  );
}

describe("backfill-journal-person-ids", () => {
  it("dry run (default): reads, prints counts, returns before any write", async () => {
    const r = await run([]);
    expect(r.code).toBe("returned");
    expect(r.dumpUpdate).not.toHaveBeenCalled();
    expect(r.reflUpdate).not.toHaveBeenCalled();
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
    expect(r.dumpUpdate).toHaveBeenCalledTimes(1);
    expect(r.dumpUpdate).toHaveBeenCalledWith({ where: { id: "d1" }, data: { personIds: ["p_dania"] } });
    expect(r.reflUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { personIds: ["p_dania", "p_mo"] } });
    expect(Object.keys(r.prisma)).not.toContain("relationshipLedger");
    expect(r.prisma.brainDump.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null, personIds: { isEmpty: true } });
  });

  it("--limit must be a positive integer", async () => {
    expect((await run(["--limit", "0"])).code).toBe(2);
    expect((await run(["--limit", "abc"])).code).toBe(2);
  });
});
