/**
 * orchestration-status-reconcile (2026-09-22)
 *
 * WHAT WAS WRONG. An sms_orchestrations row persisted `queued ·
 * outside_hours_queued` was never stamped when the delayed queue sent its
 * text: 308 rows read `queued` forever, 243 of them with a sent outbound to
 * the same phone within 36 h (docs/operations/QUEUE-CENSUS-2026-09-22.md).
 *
 * WHAT THIS PINS. The job through a fake executor that
 * renders the real drizzle queries (the join's window and lookback are bound,
 * each stamp is a guarded UPDATE by id); the details line says why; no DB →
 * 0 with a reason; a failing query THROWS (cron-rethrow contract); and the
 * scheduler registers the job (comment-stripped).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reconcileQueuedOrchestrations } from "./orchestrationStatusReconcile";

// the queueing window the job binds (module-private in the job; pinned here by the bound params)
const QUEUE_WINDOW_HOURS = 36;

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Render a drizzle `sql` object the way the driver would: text with `?` and the bound values. */
function render(q: unknown): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const walk = (node: unknown): string => {
    if (node && typeof node === "object" && Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)) {
      return (node as { queryChunks: unknown[] }).queryChunks.map(walk).join("");
    }
    if (node && typeof node === "object" && Array.isArray((node as { value?: unknown }).value)) {
      return (node as { value: string[] }).value.join("");
    }
    params.push(node);
    return "?";
  };
  return { text: walk(q).replace(/\s+/g, " ").trim(), params };
}

function fakeDb(candidates: unknown[], opts: { throwOnSelect?: boolean } = {}) {
  const issued: Array<{ text: string; params: unknown[] }> = [];
  const db = {
    async execute(q: unknown) {
      const r = render(q);
      issued.push(r);
      if (r.text.startsWith("SELECT")) {
        if (opts.throwOnSelect) throw new Error("ER_NO_SUCH_TABLE");
        return [candidates, []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  return { db, issued };
}

// the stamp decision (sent wins, then failed, else nothing) is pinned through the job below:
// its three candidates cover exactly those three outcomes.
describe("reconcileQueuedOrchestrations", () => {
  it("stamps each candidate by what its messages say, guarded by id AND the queued state, and says why", async () => {
    const { db, issued } = fakeDb([
      { id: 11, anySent: 1, anyFailed: 0, sentAt: "2026-09-22T12:05:00.000Z" },
      { id: 12, anySent: 0, anyFailed: 1, sentAt: null },
      { id: 13, anySent: 0, anyFailed: 0, sentAt: null },
    ]);
    const out = await reconcileQueuedOrchestrations(db, 7);
    expect(out).toEqual({ recordsProcessed: 2, details: `stamped sent 1 · failed 1 · left queued 1 of 3 with a message row · lookback 7d, window ${QUEUE_WINDOW_HOURS}h` });
    const select = issued[0];
    expect(select.text).toContain("WHERE o.status = 'queued' AND o.status_reason = 'outside_hours_queued'");
    expect(select.text).toContain("RIGHT(REGEXP_REPLACE(o.customer_phone, '[^0-9]', ''), 10)");
    expect(select.params).toEqual([QUEUE_WINDOW_HOURS, 7]);
    const updates = issued.slice(1);
    expect(updates).toHaveLength(2);
    expect(updates[0].text).toBe(
      "UPDATE sms_orchestrations SET status = 'sent', status_reason = ?, sent_at = COALESCE(?, NOW()), updatedAt = NOW() WHERE id = ? AND status = 'queued' AND status_reason = 'outside_hours_queued'",
    );
    expect(updates[0].params).toEqual(["sent_from_delayed_queue", "2026-09-22T12:05:00.000Z", 11]);
    expect(updates[1].text).toBe(
      "UPDATE sms_orchestrations SET status = 'failed', status_reason = ?, failed_at = NOW(), updatedAt = NOW() WHERE id = ? AND status = 'queued' AND status_reason = 'outside_hours_queued'",
    );
    expect(updates[1].params).toEqual(["delayed_queue_failed", 12]);
  });

  it("POSITIVE CONTROL: no candidates → 0, no UPDATE, and the details still name the lookback", async () => {
    const { db, issued } = fakeDb([]);
    const out = await reconcileQueuedOrchestrations(db, 7);
    expect(out.recordsProcessed).toBe(0);
    expect(out.details).toContain("of 0 with a message row · lookback 7d");
    expect(issued).toHaveLength(1);
  });

  it("no database → 0 with a reason, nothing issued", async () => {
    expect(await reconcileQueuedOrchestrations(null)).toEqual({ recordsProcessed: 0, details: "No DB — nothing reconciled" });
  });

  it("FAIL-CLOSED: a failing query throws so cron_log records failed, not completed-with-0", async () => {
    const { db } = fakeDb([], { throwOnSelect: true });
    await expect(reconcileQueuedOrchestrations(db, 7)).rejects.toThrow("ER_NO_SUCH_TABLE");
  });

  it("never sends: the module does not import sms.ts or call sendSms", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "./orchestrationStatusReconcile.ts"), "utf8"));
    expect(src).not.toMatch(/sendSms|from "\.\.\/\.\.\/sms"|queueForLater/);
  });

  it("the scheduler registers it on the pulse tier (comment-stripped)", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../scheduler.ts"), "utf8"));
    const at = src.indexOf('name: "orchestration-status-reconcile"');
    expect(at).toBeGreaterThan(0);
    const pulseAt = src.indexOf('name: "pulse"');
    const hourlyAt = src.indexOf('name: "hourly"');
    expect(at).toBeGreaterThan(pulseAt);
    expect(at).toBeLessThan(hourlyAt);
    expect(src.slice(at, at + 400)).toContain("reconcileQueuedOrchestrations");
  });
});
