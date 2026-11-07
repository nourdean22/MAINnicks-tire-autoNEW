/**
 * The "IDLE, recovery cron is DRY-RUN" Telegram reminder is not a daily message (2026-11-07).
 *
 * While FEATURE_DECLINED_RECOVERY is off, the cron ran every day and sent the same "flip the env var"
 * message with the same dollar figure. Now it claims a cron_alerts_fired row first (services/alertClaim.ts):
 * one message per $1,000 of recoverable pool, so it speaks again when the money on the table has grown
 * and stays quiet while nothing changed. The fake db implements INSERT IGNORE (a repeat pair affects 0 rows),
 * so the real claim SQL and the dedupe decision both run; only the clock, the transport and the rows are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sent: [] as Array<{ text: string; channel?: string; cls?: string }>,
  accept: true,
  claims: new Set<string>(),
  rows: [] as unknown[],
}));

/** Bound string params of a drizzle sql`` template, in order. */
function sqlParams(query: unknown): string[] {
  const chunks = ((query as { queryChunks?: unknown[] }).queryChunks ?? []) as unknown[];
  return chunks.filter((c): c is string => typeof c === "string");
}
function sqlText(query: unknown): string {
  const chunks = ((query as { queryChunks?: unknown[] }).queryChunks ?? []) as unknown[];
  return chunks
    .filter((c) => c && typeof c === "object" && "value" in c)
    .map((c) => (c as { value: string[] }).value.join(""))
    .join("");
}

vi.mock("../../db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const text = sqlText(q);
      const [key, day] = sqlParams(q);
      if (/DELETE FROM cron_alerts_fired/i.test(text)) {
        h.claims.delete(`${key}|${day}`);
        return [{ affectedRows: 1 }];
      }
      if (/INSERT IGNORE INTO cron_alerts_fired/i.test(text)) {
        if (h.claims.has(`${key}|${day}`)) return [{ affectedRows: 0 }];
        h.claims.add(`${key}|${day}`);
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => h.rows }) }) }),
  }),
}));
vi.mock("../../services/telegram", () => ({
  sendTelegram: async () => true,
  sendTelegramMessage: async (text: string, channel?: string, cls?: string) => {
    h.sent.push({ text, channel, cls });
    return h.accept;
  },
}));

const estimate = (id: number, cents: number) => ({
  id, customerName: "Synthetic Lead", customerPhone: `21655501${String(id).padStart(2, "0")}`, serviceDescription: "brake pads",
  estimatedAmount: cents, estimateDate: new Date(Date.now() - 10 * 86_400_000),
  followUp3dSent: 0, followUp3dAttemptedAt: null, followUp7dSent: 0, followUp7dAttemptedAt: null,
  followUp14dSent: 0, followUp14dAttemptedAt: null, followUp30dSent: 0, followUp30dAttemptedAt: null,
  followUp45dSent: 0, followUp45dAttemptedAt: null,
  recoveryProfile: "P0", statedConcern: null, statedConcernSource: null, recoveryHoldout: 0,
});

const dryRun = async () =>
  (await import("./declinedWorkRecovery")).runDeclinedWorkRecovery({ bypassBusinessHoursCheck: true, dryRun: true });

beforeEach(() => {
  h.sent.length = 0;
  h.accept = true;
  h.claims.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
  h.rows = [estimate(1, 250_000), estimate(2, 300_000)]; // $5,500 in cents
});
afterEach(() => {
  vi.useRealTimers();
});

describe("declined recovery · the IDLE dry-run reminder", () => {
  it("KEEP: the first run still tells Nour the money is idle, as a digest, on the critical channel", async () => {
    await dryRun();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ channel: "critical", cls: "digest" });
    expect(h.sent[0].text).toContain("IDLE");
    expect(h.sent[0].text).toContain("FEATURE_DECLINED_RECOVERY=1");
  });

  it("the next ticks and the next day, with the same pool, send nothing", async () => {
    await dryRun();
    await dryRun();
    vi.setSystemTime(new Date("2026-11-08T15:00:00Z"));
    await dryRun();
    expect(h.sent).toHaveLength(1);
  });

  it("a pool that grew past the next $1,000 is a new state and speaks once", async () => {
    await dryRun();
    h.rows = [...h.rows, estimate(3, 150_000)]; // $7,000
    await dryRun();
    await dryRun();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].text).toContain("$7000");
  });

  it("a pool that moved within the same $1,000 is the same state", async () => {
    await dryRun();
    h.rows = [estimate(1, 250_000), estimate(2, 304_000)]; // $5,540 -> still the $5,000 band
    await dryRun();
    expect(h.sent).toHaveLength(1);
  });

  it("a failed delivery gives the claim back, so the next run tries again, and the delivered one then holds", async () => {
    h.accept = false;
    await dryRun();
    h.accept = true;
    await dryRun();
    await dryRun();
    expect(h.sent).toHaveLength(2); // the failed attempt and the accepted one reached the transport; the third run was deduped
  });
});
