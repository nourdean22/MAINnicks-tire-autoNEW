/**
 * ROS-084 · the review-SMS send path must not invent its own safety limits.
 *
 * Two reads in db.ts fabricated values on an unreadable database, and BOTH
 * fabrications pointed toward SENDING rather than holding:
 *
 *   getReviewSettings        -> invented `enabled: 1`. That is the operator's
 *                               OFF SWITCH. A shop that had deliberately turned
 *                               review texts off had them turned back on for the
 *                               duration of any outage, by a literal in db.ts.
 *   getReviewRequestsSentToday -> invented `0`. That number is the daily-cap
 *                               DENOMINATOR, compared against maxPerDay on the
 *                               very next line, so the cap could not fire.
 *
 * ★ THE PRECEDENT IS TWELVE LINES AWAY, on the same path, and it was already
 * right: isPhoneOnReviewCooldown does `if (!db) return true; // Fail safe: don't
 * send if DB is down`. Three reads, one outage, and two of them pointed the
 * other way for no stated reason. The last case below pins that precedent so a
 * future "consistency" pass cannot flip the one that was correct.
 *
 * ON REACHABILITY, stated honestly rather than overclaimed: after #1338 made
 * getPendingReviewRequests throw, a TOTAL outage already fails the run before
 * any send — the queue read throws a few lines after these two. So this change
 * removes a hazard that ORDERING currently masks, not one firing today. That
 * ordering is incidental: nothing enforces it, and moving the queue read below
 * the cap check would re-open the bypass silently. The ordering case below is
 * what turns "currently safe" into "cannot regress".
 *
 * DB-unavailable is induced by clearing DATABASE_URL, which is what getDb()
 * actually branches on — getDb is defined inside db.ts and called through its
 * local binding, so a module mock of the export would not intercept the internal
 * call sites and these would pass while exercising nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const QUEUE = readFileSync(join(__dirname, "routers", "reviewRequests.ts"), "utf8");
const DB_SRC = readFileSync(join(__dirname, "db.ts"), "utf8");
const CLIENT = readFileSync(
  join(__dirname, "..", "client", "src", "pages", "admin", "outreach", "ReviewRequestsSection.tsx"),
  "utf8",
);

beforeEach(() => {
  vi.resetModules(); // db.ts caches its pool in module state
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the off switch is never invented", () => {
  it("getReviewSettings throws instead of returning enabled:1", async () => {
    const { getReviewSettings } = await import("./db");
    await expect(getReviewSettings()).rejects.toThrow(/settings are unknown, not the defaults/i);
  });

  it("names the actual stake — whether review texts are enabled", async () => {
    const { getReviewSettings } = await import("./db");
    await expect(getReviewSettings()).rejects.toThrow(/enabled cannot be determined/i);
  });

  it("does not hand back invented defaults after a failed read-back either", () => {
    // An insert that reports success followed by a read that returns nothing is
    // a broken database, not an empty one — and returning the same invented row
    // there would reproduce the defect one layer in, looking like a successful
    // bootstrap.
    expect(DB_SRC).toMatch(/could not be read back after insert/);
    expect(DB_SRC).not.toMatch(/return created \|\| \{ id: 1, enabled: 1/);
  });

  it("still bootstraps a fresh install — the throw is on !db, not on an empty table", () => {
    // The defaults INSERT sits on a live-database branch. Throwing when there is
    // no handle must not break a first run against a real, empty database.
    const fn = DB_SRC.slice(
      DB_SRC.indexOf("export async function getReviewSettings"),
      DB_SRC.indexOf("export async function updateReviewSettings"),
    );
    expect(fn).toMatch(/await db\.insert\(reviewSettings\)\.values\(\{ enabled: 1/);
    expect(fn.indexOf("if (!db) throw")).toBeLessThan(fn.indexOf("await db.insert(reviewSettings)"));
  });
});

describe("the daily cap denominator is never invented", () => {
  it("getReviewRequestsSentToday throws instead of returning 0", async () => {
    const { getReviewRequestsSentToday } = await import("./db");
    await expect(getReviewRequestsSentToday()).rejects.toThrow(/unknown, not zero/i);
  });

  it("names what a fabricated zero actually costs — the cap cannot be evaluated", async () => {
    const { getReviewRequestsSentToday } = await import("./db");
    await expect(getReviewRequestsSentToday()).rejects.toThrow(/daily cap cannot be evaluated/i);
  });
});

describe("the ordering that currently masks this must not be able to drift", () => {
  it("reads sentToday BEFORE comparing it to maxPerDay", () => {
    const read = QUEUE.indexOf("const sentToday = await getReviewRequestsSentToday()");
    const compare = QUEUE.indexOf("if (sentToday >= settings.maxPerDay)");
    expect(read).toBeGreaterThan(-1);
    expect(compare).toBeGreaterThan(read);
  });

  it("still reads the queue AFTER the cap check — the send loop's last guard", () => {
    // #1338 made getPendingReviewRequests throw, which is what makes a total
    // outage safe today. If a refactor ever moved that read ABOVE the cap check,
    // the cap would once again be the only thing standing between an outage and
    // a batch — so the relative order is pinned, not assumed.
    const compare = QUEUE.indexOf("if (sentToday >= settings.maxPerDay)");
    const queueRead = QUEUE.indexOf("const pending = await getPendingReviewRequests()");
    expect(queueRead).toBeGreaterThan(compare);
  });

  it("gates on settings.enabled before anything else in the send loop", () => {
    const settingsRead = QUEUE.indexOf("const settings = await getReviewSettings()", QUEUE.indexOf("export async function processReviewRequestQueue"));
    const enabledGate = QUEUE.indexOf("if (!settings.enabled)", settingsRead);
    expect(settingsRead).toBeGreaterThan(-1);
    expect(enabledGate).toBeGreaterThan(settingsRead);
    expect(QUEUE.indexOf("await sendSms(")).toBeGreaterThan(enabledGate);
  });
});

describe("the precedent that was already right must not be flipped", () => {
  it("isPhoneOnReviewCooldown still fails CLOSED on an unreadable database", async () => {
    // The direction matters more than the value: on this path, "I do not know
    // whether this customer was already texted" must block, not permit.
    const { isPhoneOnReviewCooldown } = await import("./db");
    await expect(isPhoneOnReviewCooldown("2165550123", 30)).resolves.toBe(true);
  });
});

describe("the settings FORM is disabled, not em-dashed", () => {
  it("replaces the whole form — Save included — when settings could not be read", () => {
    // An em dash on a toggle means nothing and a blank number input still
    // submits, so the stat-card idiom does not transfer. The form is not
    // rendered at all.
    expect(CLIENT).toMatch(/const settingsUnknown = settingsError/);
    expect(CLIENT).toMatch(/\) : settingsUnknown \? \(/);
    const guard = CLIENT.indexOf(") : settingsUnknown ? (");
    const save = CLIENT.indexOf("onClick={handleSaveSettings}");
    expect(save).toBeGreaterThan(guard);
  });

  it("says WHY the form is hidden — an overwrite, not just a stale display", () => {
    expect(CLIENT).toMatch(/overwrite your real stored settings/);
    expect(CLIENT).toMatch(/whether review texts are enabled at all/);
  });

  it("guards on DATA, not just on isError — the offline PWA is the dangerous shape", () => {
    // react-query v5 defaults to networkMode "online", so an offline device
    // PAUSES the query: isLoading false (it is isPending && isFetching), isError
    // false, data undefined. An isError-only guard renders the form, the toggle
    // computes `(null ?? undefined) === 1` and paints itself OFF, and one tap
    // fires updateSettings({ enabled: 1 }) — turning the programme ON from a
    // control showing OFF, on the exact device this admin is used from.
    expect(CLIENT).toMatch(/const settingsUnknown = settingsError \|\| \(!settingsLoading && !settings\);/);
  });

  it("does not tell the operator sends have stopped when only their DEVICE is offline", () => {
    // The two shapes mean opposite things about the shop. Collapsing them would
    // replace the removed false statement with a new one.
    expect(CLIENT).toMatch(/no review texts are going out while this persists/);
    expect(CLIENT).toMatch(/The shop's automation is unaffected/);
    expect(CLIENT).toMatch(/settingsError\s*\n?\s*\?/);
  });

  it("does not move the fabrication from the server to the client", () => {
    // The form carried its own invented defaults — and they did not even AGREE
    // with the server's: the client invented a 120-minute delay where db.ts
    // invented 1440. Deleting the server literal while leaving these would have
    // relocated the defect, not removed it, and hidden it better.
    expect(CLIENT).not.toMatch(/settings\?\.enabled \?\? 1/);
    expect(CLIENT).not.toMatch(/settings\?\.delayMinutes \?\? \d+/);
    expect(CLIENT).not.toMatch(/settings\?\.maxPerDay \?\? \d+/);
    expect(CLIENT).not.toMatch(/settings\?\.cooldownDays \?\? \d+/);
  });
});

describe("a declined run says which decline it was", () => {
  it("the disabled-by-settings exit carries a reason like the other three", () => {
    // cron/jobs/reviewRequests.ts puts `reason` into cron_log details. This exit
    // was the only one of four without one, so "switched off on purpose" logged
    // an empty-detail zero — indistinguishable from a decline nobody recorded.
    // Same shape as the recordsProcessed fix in #1338: a zero is only useful
    // when it says which zero it is.
    expect(QUEUE).toMatch(/reason: "review requests are disabled in settings"/);
    const exits = QUEUE.match(/return \{ processed: 0, sent: 0, failed: 0[^}]*\}/g) ?? [];
    expect(exits.length).toBeGreaterThanOrEqual(4);
    expect(exits.every((e) => e.includes("reason"))).toBe(true);
  });
});
