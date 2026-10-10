/**
 * scripts/audit-raw-sql-columns.ts · audit 2026-10-10 (06-F15).
 * lib/ai/calibrated-confidence.ts read `cm."feedbackScore"` through
 * $queryRawUnsafe; the real column is `feedback_score` (@map), so the query
 * threw, `.catch` returned [] and /api/brain/calibrate reported cold start
 * forever. The audit only looked for UNQUOTED camelCase on camel-kept tables,
 * the opposite shape. Pinned: it also flags a QUOTED field name whose column
 * is @map'ed elsewhere, in $queryRaw and $queryRawUnsafe alike.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseSchema, scanFile, walk } from "../../scripts/audit-raw-sql-columns";

const APP = join(__dirname, "../..");
const models = parseSchema(join(APP, "prisma", "schema.prisma"));

function fixture(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "raw-sql-"));
  const f = join(dir, "q.ts");
  writeFileSync(f, src);
  return f;
}

describe("audit-raw-sql-columns", () => {
  it("flags a quoted @map'ed field in $queryRawUnsafe (the calibrated-confidence shape)", () => {
    const f = fixture('await prisma.$queryRawUnsafe(`SELECT cm."feedbackScore" FROM chat_messages cm`);');
    expect(scanFile(f, models)).toEqual([expect.objectContaining({ table: "chat_messages", column: "feedbackScore" })]);
  });

  it("flags the same in $queryRaw, and leaves the correct snake_case spelling alone", () => {
    expect(scanFile(fixture('await prisma.$queryRaw`SELECT "feedbackScore" FROM chat_messages`;'), models)).toHaveLength(1);
    expect(scanFile(fixture('await prisma.$queryRawUnsafe(`SELECT cm.feedback_score FROM chat_messages cm`);'), models)).toEqual([]);
  });

  it("an output alias spelled as the field name is not a column reference", () => {
    const f = fixture('await prisma.$queryRawUnsafe(`SELECT pinned_summary AS "pinnedSummary" FROM chat_conversations`);');
    expect(scanFile(f, models)).toEqual([]);
  });

  it("a quoted camel-kept column is correct and not flagged", () => {
    const f = fixture('await prisma.$queryRawUnsafe(`SELECT 1 FROM vector_embeddings ve WHERE ve."sourceType" = $1`);');
    expect(scanFile(f, models)).toEqual([]);
  });

  it("lib/ai/calibrated-confidence.ts is clean", () => {
    expect(scanFile(join(APP, "lib/ai/calibrated-confidence.ts"), models)).toEqual([]);
  });

  it("the whole app/ + lib/ tree scans clean (what `pnpm check:raw-sql` gates)", () => {
    const files = [...walk(join(APP, "app")), ...walk(join(APP, "lib"))];
    expect(files.length).toBeGreaterThan(500);
    const findings = files.flatMap((f) => scanFile(f, models)).map((x) => `${x.file.slice(APP.length)}:${x.column}`);
    expect(findings).toEqual([]);
  });
});
