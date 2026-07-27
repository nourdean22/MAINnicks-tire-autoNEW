/**
 * The migration drift gate must parse ADD INDEX as an index.
 *
 * THE FAILURE THIS PREVENTS
 * `ALTER TABLE scheduled_posts ADD INDEX idx_scheduled_inventory (inventoryId)`
 * fell through to the ADD COLUMN branch, whose regex is permissive enough to
 * capture the keyword itself: column name "INDEX", type "idx_scheduled_inventory".
 * The gate then reported
 *
 *     ✗ scheduled_posts.INDEX missing
 *
 * which is unresolvable — no such column can ever exist — so 0096 sat BLOCKING in
 * `pnpm run migrations:check` (a `pnpm run verify` gate) while its index was
 * present in production the entire time.
 *
 * The quieter half is worse: because ADD INDEX never reached the index verifier,
 * a genuinely missing index and this false alarm produced the same output. The
 * gate could not verify indexes at all, and a permanently-red entry teaches
 * operators to stop reading it.
 *
 * DESIGN UNDER TEST
 * ADD INDEX is matched BEFORE the generic ADD branch and returns kind:"index",
 * which the existing verifier already checks properly (existence, uniqueness,
 * covered columns). A keyword guard is kept in the column loop as well, so a
 * multi-clause ALTER that mixes a real column with an index cannot smuggle one
 * through.
 */
import { describe, expect, it } from "vitest";
import { parseStatement } from "../scripts/reconcile-migrations.mjs";

describe("reconcile-migrations · ADD INDEX is an index, not a column", () => {
  it("parses the exact 0096 statement as an index", () => {
    const st = parseStatement("ALTER TABLE scheduled_posts ADD INDEX idx_scheduled_inventory (inventoryId)");
    expect(st.kind).toBe("index");
    expect(st.name).toBe("idx_scheduled_inventory");
    expect(st.table).toBe("scheduled_posts");
    expect(st.columns).toEqual(["inventoryId"]);
    expect(st.unique).toBe(false);
  });

  it("never yields a column literally named INDEX (the shipped bug)", () => {
    const st = parseStatement("ALTER TABLE scheduled_posts ADD INDEX idx_scheduled_inventory (inventoryId)");
    expect(st.kind).not.toBe("add_column");
    expect((st as { column?: string }).column).not.toBe("INDEX");
  });

  it("handles ADD UNIQUE INDEX and ADD KEY", () => {
    const uniq = parseStatement("ALTER TABLE t ADD UNIQUE INDEX uq_a (a, b)");
    expect(uniq.kind).toBe("index");
    expect(uniq.unique).toBe(true);
    expect(uniq.columns).toEqual(["a", "b"]);

    expect(parseStatement("ALTER TABLE t ADD KEY k_a (a)").kind).toBe("index");
  });

  it("still parses a real ADD COLUMN correctly", () => {
    const st = parseStatement("ALTER TABLE `nickgpt_training_examples` ADD COLUMN `edit_categories_json` text NULL");
    expect(st.kind).toBe("add_column");
    expect(st.column).toBe("edit_categories_json");
    expect(st.type).toBe("text");
  });

  it("drops the index clause but keeps the column in a mixed multi-clause ALTER", () => {
    const st = parseStatement("ALTER TABLE t ADD COLUMN a varchar(10) NULL, ADD INDEX idx_a (a)");
    // One real column survives; the index clause must not become a phantom column.
    expect(st.kind).toBe("add_column");
    expect(st.column).toBe("a");
  });

  it("importing the module does not run the CLI (no DB connection on import)", () => {
    // If the direct-invocation guard regressed, importing above would have tried
    // to connect and this file would never have reached an assertion.
    expect(typeof parseStatement).toBe("function");
  });
});
