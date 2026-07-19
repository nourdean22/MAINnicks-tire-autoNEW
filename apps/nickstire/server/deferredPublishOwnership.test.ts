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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** The `.set({...})` block of every update to socialContentInventory in a file. */
function inventorySetBlocks(source: string): string[] {
  const blocks: string[] = [];
  const re = /update\(socialContentInventory\)[\s\S]{0,80}?\.set\(\{([\s\S]{0,400}?)\}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) blocks.push(m[1]);
  return blocks;
}

describe("a path that delegates to scheduled_posts must not arm the inventory publisher", () => {
  it.each([
    ["server/routers/instagramAdmin.ts", "schedulePost"],
    ["server/routers/instagramStudio.ts", "schedule"],
  ])("%s (%s) inserts into scheduled_posts", (file) => {
    // Establishes the premise: these files DO delegate. If this ever stops being
    // true the rule below is measuring nothing, and the test should be revisited.
    expect(read(file)).toMatch(/insert\(scheduledPosts\)/);
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
    "server/routers/instagramAdmin.ts",
    "server/routers/instagramStudio.ts",
  ])("%s still marks the row 'scheduled' so the Queue filter keeps working", (file) => {
    // The operator must still see the item as scheduled. Only the TIMESTAMP moves
    // to the scheduled_posts row that owns the publish.
    const blocks = inventorySetBlocks(read(file));
    expect(blocks.some((b) => /status:\s*"scheduled"/.test(b))).toBe(true);
  });
});

describe("the publisher's allowlist is left alone on purpose", () => {
  it("socialInventoryPublisher still serves its ONE legitimate caller", () => {
    // content.ts actOnInventoryItem sets status + scheduledAt and creates NO
    // scheduled_posts row — it is the honest user of this publisher. Narrowing
    // the allowlist to fix the double-post would have broken it, which is why
    // the fix lives at the two delegating call sites instead.
    const pub = read("server/cron/jobs/socialInventoryPublisher.ts");
    expect(pub).toMatch(/'approved',\s*'scheduled'/);

    const content = read("server/routers/content.ts");
    expect(content).toMatch(/\.set\(\{ status, scheduledAt: scheduledDate \}\)/);
  });
});
