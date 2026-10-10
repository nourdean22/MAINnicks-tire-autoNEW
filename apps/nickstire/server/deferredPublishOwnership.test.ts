/**
 * ONE OWNER PER DEFERRED PUBLISH.
 *
 * There are two independent publishers over two different tables:
 *
 *   scheduledPosts.ts:54           drains `scheduled_posts`
 *                                  WHERE status='pending' AND scheduledAt <= now
 *   socialInventoryPublisher.ts:29 publishes `social_content_inventory`
 *                                  WHERE status IN ('approved','scheduled')
 *                                    AND scheduled_at <= now
 *
 * A caller that inserts a scheduled_posts row AND stamps
 * social_content_inventory.scheduled_at hands the same content to both, at the
 * same moment. The two tables carry NO link to each other — scheduled_posts has
 * no inventoryId column — so neither publisher can see the other's claim, and
 * each one's at-most-once CAS only protects it from ITSELF. The result is a
 * guaranteed duplicate post to Instagram.
 *
 * It never fired only because social_content_inventory.scheduled_at has never
 * been non-null in production (measured 2026-07-19: 0 rows, ever). The first
 * schedule performed from the Queue with an inventoryId would have posted twice.
 *
 * Asserted against SOURCE because the alternative — standing up two cron workers,
 * a Meta double, and two tables — tests the harness rather than the rule. What
 * must not regress is one line in each of two files, and that is exactly what a
 * source assertion pins.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * The full argument of every `.set(...)` that follows an
 * `update(socialContentInventory)`, extracted with BALANCED PARENS — no length
 * cap and no "stop at the first `})`".
 *
 * The previous version was `.set\(\{([\s\S]{0,400}?)\}\)`. A `.set()` block
 * containing a ternary like `...(status === "published" ? {…} : {})` closes on
 * that inner `{})` FIRST, so the lazy match truncated the block there. A
 * `scheduledAt:` added after the ternary — the exact duplicate-post regression
 * this file exists to prevent — landed outside the captured span and the test
 * stayed green. Proven by the "extractor catches the documented bypass" test
 * below.
 *
 * Quote-aware so a stray ")" inside a string literal cannot unbalance it.
 */
function inventorySetBlocks(source: string): string[] {
  const blocks: string[] = [];
  const marker = /update\(socialContentInventory\)/g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(source)) !== null) {
    const setKw = source.indexOf(".set(", m.index);
    if (setKw === -1) continue;
    let i = setKw + ".set".length; // now at the "("
    let depth = 0;
    let quote: string | null = null;
    const start = i + 1;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === "\\") { i++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (depth === 0) break; }
    }
    blocks.push(source.slice(start, i));
  }
  return blocks;
}

describe("a path that delegates to scheduled_posts must not arm the inventory publisher", () => {
  it.each([
    // instagramAdmin.schedulePost was DELETED 2026-07-24 (zero callers +
    // integrity holes) — instagramStudio.schedule is now the only
    // INVENTORY-LINKED writer of scheduled_posts rows (adStudio.ts also
    // inserts, but its rows carry no inventory linkage and arm nothing else).
    ["server/routers/instagramStudio.ts", "schedule"],
  ])("%s (%s) inserts into scheduled_posts", (file) => {
    // Establishes the premise: these files DO delegate. If this ever stops being
    // true the rule below is measuring nothing, and the test should be revisited.
    expect(read(file)).toMatch(/insert\(scheduledPosts\)/);
  });

  it("instagramAdmin no longer writes scheduled_posts at all (schedulePost deleted)", () => {
    expect(read("server/routers/instagramAdmin.ts")).not.toMatch(/insert\(scheduledPosts\)/);
  });

  it.each([
    "server/routers/instagramAdmin.ts",
    "server/routers/instagramStudio.ts",
  ])("%s never writes scheduledAt onto a socialContentInventory row", (file) => {
    for (const block of inventorySetBlocks(read(file))) {
      expect(block).not.toMatch(/\bscheduledAt\s*:/);
    }
  });

  it.each([
    "server/routers/instagramStudio.ts",
  ])("%s still marks the row 'scheduled' so the Queue filter keeps working", (file) => {
    // The operator must still see the item as scheduled. Only the TIMESTAMP moves
    // to the scheduled_posts row that owns the publish.
    const blocks = inventorySetBlocks(read(file));
    expect(blocks.some((b) => /status:\s*"scheduled"/.test(b))).toBe(true);
  });
});

describe("the source-assertion extractor cannot be bypassed", () => {
  // This is the guard for the guard. The old length-capped regex let a
  // scheduledAt added AFTER a `...(x ? {…} : {})` ternary escape the check.
  // If inventorySetBlocks ever regresses to a lazy `}\)` match, THIS fails.
  it("captures scheduledAt placed after a ternary that contains an inner {})", () => {
    const synthetic = [
      'await d.update(socialContentInventory).set({',
      '  status,',
      '  ...(status === "published" ? { publishedAt: new Date() } : {}),',
      '  scheduledAt: new Date(),',
      '}).where(eq(socialContentInventory.id, id));',
    ].join("\n");
    const blocks = inventorySetBlocks(synthetic);
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toMatch(/scheduledAt\s*:/);
  });

  it("does not false-positive on a clean update", () => {
    const clean = 'd.update(socialContentInventory).set({ status: "scheduled" }).where(x)';
    const blocks = inventorySetBlocks(clean);
    expect(blocks.length).toBe(1);
    expect(blocks[0]).not.toMatch(/scheduledAt\s*:/);
  });
});

describe("the inventory publisher is gone (2026-10-10 audit, A1)", () => {
  // Its one feeder, content.actOnInventoryItem, had no caller in the PWA or any
  // script, while the cron it armed republished ANY inventory row (published,
  // rejected, a reel) whose scheduled_at fell in the past: no approval check,
  // no disclosure flag, no attempt ledger. The door above (scheduled_posts
  // owns every deferred publish) is now the only one, and this pins that the
  // bypass cannot quietly come back as a cron, a registry job, or a feeder.
  it("has no cron, no registry job, and no feeder procedure", () => {
    expect(existsSync(resolve(process.cwd(), "server/cron/jobs/socialInventoryPublisher.ts"))).toBe(false);
    expect(read("server/cron/scheduler.ts")).not.toMatch(/social-inventory-publisher|SOCIAL_INVENTORY_PUBLISH_ENABLED/);
    expect(read("server/cron/index.ts")).not.toMatch(/social-inventory-publisher|socialInventoryPublisher/);
    expect(read("server/routers/content.ts")).not.toMatch(/actOnInventoryItem/);
  });

  it("nothing but a scheduled_posts row publishes an inventory item later", () => {
    // The column the dead cron keyed on must not grow a new reader.
    const serverFiles = ["server/cron/scheduler.ts", "server/cron/index.ts", "server/routers/content.ts", "server/routers/instagramStudio.ts", "server/routers/instagramAdmin.ts"];
    for (const file of serverFiles) {
      expect(read(file)).not.toMatch(/lte\(socialContentInventory\.scheduledAt/);
    }
  });
});
