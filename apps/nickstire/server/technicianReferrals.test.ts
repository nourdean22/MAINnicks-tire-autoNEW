/**
 * Technician-referral tracking — the $300-after-90-days bonus advertised on
 * /careers had no backing record before this feature: the referrer's name
 * lived only inside a free-text note concatenated onto the applicant's
 * `leads.problem` field, so the shop could not reliably tell who referred
 * whom, verify the 90-day condition, or pay the bonus out without a dispute.
 *
 * This suite does NOT hit a real database (no DATABASE_URL in this worktree,
 * per harness-worktree-setup — and per AGENTS.md, tests must not depend on
 * live credentials). It proves two classes of thing instead:
 *
 *  1. `isMissingTableError` (server/db.ts) behaviorally distinguishes MySQL's
 *     "table doesn't exist" (1146 / ER_NO_SUCH_TABLE) from every other kind
 *     of error — a real positive-AND-negative control, not just "returns
 *     true once". This is the switch the empty-vs-error handling in
 *     getTechnicianReferrals/createTechnicianReferral depends on entirely;
 *     if it ever degrades to "true for everything", a genuine outage would
 *     silently render as "migration not applied yet" instead of a real
 *     error, and if it degrades to "true for nothing" the app would 500 on
 *     every /careers submission and every admin Leads page load until
 *     drizzle/0121_technician_referrals.sql is applied to production.
 *
 *  2. Source-level structural checks (same discipline as
 *     crossSellDeadQuery.test.ts in this file's own directory) that the
 *     safety properties this feature depends on are actually present in the
 *     code, so a future edit that quietly removes one fails CI instead of
 *     failing silently in production: the missing-table guard wraps both
 *     read and write paths, the public `submit` mutation never throws to
 *     the applicant on a DB failure, hire-confirmation stamps eligibility
 *     alongside hiredAt (not recomputed later), and the new router is
 *     mapped to a real permission rather than falling through to
 *     security.manage on every query (which would 403 non-owner admins).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isMissingTableError } from "./db";
import { permissionForAdminProcedure } from "../shared/adminPermissions";

const ROUTER_SRC = readFileSync(new URL("./routers/technicianReferrals.ts", import.meta.url), "utf8");
const DB_SRC = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const SCHEMA_SRC = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
const CAREERS_SRC = readFileSync(
  new URL("../client/src/pages/Careers.tsx", import.meta.url),
  "utf8",
);

describe("isMissingTableError — the empty-vs-error switch", () => {
  it("is true for MySQL's real ER_NO_SUCH_TABLE shape (code)", () => {
    expect(isMissingTableError({ code: "ER_NO_SUCH_TABLE", errno: 1146 })).toBe(true);
  });

  it("is true even if only errno 1146 is present (some drivers omit `code`)", () => {
    expect(isMissingTableError({ errno: 1146 })).toBe(true);
  });

  it("negative control: is FALSE for an unrelated MySQL error — a real outage must not be swallowed", () => {
    expect(isMissingTableError({ code: "ER_ACCESS_DENIED_ERROR", errno: 1045 })).toBe(false);
  });

  it("negative control: is FALSE for a generic connection error with no MySQL code at all", () => {
    expect(isMissingTableError(new Error("connect ECONNREFUSED"))).toBe(false);
  });

  it("negative control: is FALSE for null/undefined (never throws on non-object input)", () => {
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
  });
});

describe("db.ts: both the write and read paths catch the missing-table case explicitly", () => {
  it("createTechnicianReferral catches it and returns a soft failure, not a throw", () => {
    const fn = DB_SRC.slice(DB_SRC.indexOf("export async function createTechnicianReferral"));
    const body = fn.slice(0, fn.indexOf("\nexport async function getTechnicianReferrals"));
    expect(body).toMatch(/isMissingTableError\(err\)/);
    expect(body).toMatch(/migrationPending: true as const/);
  });

  it("getTechnicianReferrals catches it and returns migrationPending, distinct from a genuinely empty list", () => {
    const fn = DB_SRC.slice(DB_SRC.indexOf("export async function getTechnicianReferrals"));
    const body = fn.slice(0, fn.indexOf("\nexport async function updateTechnicianReferralStatus"));
    expect(body).toMatch(/isMissingTableError\(err\)/);
    expect(body).toMatch(/migrationPending: true as const, rows: \[\]/);
    // The no-DB-connection branch is a SEPARATE case from "table missing" —
    // both must report migrationPending: false there, since "no DB at all"
    // is its own distinct unknown, not evidence the migration wasn't applied.
    expect(body).toMatch(/if \(!db\) return \{ available: true as const, migrationPending: false as const/);
  });

  it("a real (non-missing-table) error is RE-THROWN, not swallowed, in both functions", () => {
    const createFn = DB_SRC.slice(
      DB_SRC.indexOf("export async function createTechnicianReferral"),
      DB_SRC.indexOf("export async function getTechnicianReferrals"),
    );
    const getFn = DB_SRC.slice(
      DB_SRC.indexOf("export async function getTechnicianReferrals"),
      DB_SRC.indexOf("export async function updateTechnicianReferralStatus"),
    );
    for (const body of [createFn, getFn]) {
      expect(body).toMatch(/throw err;/);
    }
  });
});

describe("the router never lets a missing-table failure become a broken /careers submission", () => {
  it("submit wraps createTechnicianReferral in try/catch and degrades to a soft failure", () => {
    const submitBlock = ROUTER_SRC.slice(
      ROUTER_SRC.indexOf("submit: publicProcedure"),
      ROUTER_SRC.indexOf("list: adminProcedure"),
    );
    expect(submitBlock).toMatch(/try \{/);
    expect(submitBlock).toMatch(/catch \(err\)/);
    expect(submitBlock).toMatch(/return \{ success: false \} as const;/);
  });

  it("list is an adminProcedure (not publicProcedure) — referral data is not customer-public", () => {
    const listLine = ROUTER_SRC.slice(
      ROUTER_SRC.indexOf("list: "),
      ROUTER_SRC.indexOf("markHired:"),
    );
    expect(listLine).toMatch(/adminProcedure\.query/);
  });
});

describe("markHired stamps eligibility as a stored fact, not a later recomputation", () => {
  it("hiredAt and eligibleAt are computed together, in the same handler, from one `new Date()`", () => {
    const block = ROUTER_SRC.slice(
      ROUTER_SRC.indexOf("markHired: adminProcedure"),
      ROUTER_SRC.indexOf("markPaid: adminProcedure"),
    );
    expect(block).toMatch(/const hiredAt = new Date\(\);/);
    expect(block).toMatch(/const eligibleAt = new Date\(hiredAt\.getTime\(\) \+ NINETY_DAYS_MS\);/);
  });

  it("the 90-day constant really is 90 days, not some other window", () => {
    const match = /const NINETY_DAYS_MS = (\d+) \* (\d+) \* (\d+) \* (\d+) \* (\d+);/.exec(ROUTER_SRC);
    expect(match, "NINETY_DAYS_MS definition not found or reshaped").toBeTruthy();
    const factors = match!.slice(1).map(Number);
    expect(factors.reduce((a, b) => a * b, 1)).toBe(90 * 24 * 60 * 60 * 1000);
  });
});

describe("markPaid enforces the 90-day wait server-side, not just via the button being shown", () => {
  it("fetches the referral and checks both status and eligibleAt before paying", () => {
    const block = ROUTER_SRC.slice(
      ROUTER_SRC.indexOf("markPaid: adminProcedure"),
      ROUTER_SRC.indexOf("disqualify: adminProcedure"),
    );
    expect(block).toMatch(/getTechnicianReferralById\(input\.id\)/);
    expect(block).toMatch(/referral\.status !== "eligible"/);
    expect(block).toMatch(/referral\.eligibleAt\.getTime\(\) > Date\.now\(\)/);
    expect(block).toMatch(/throw new TRPCError/);
  });

  it("getTechnicianReferralById exists in db.ts and throws on a missing row rather than returning undefined", () => {
    const fn = DB_SRC.slice(
      DB_SRC.indexOf("export async function getTechnicianReferralById"),
      DB_SRC.indexOf("export async function updateTechnicianReferralStatus"),
    );
    expect(fn).toMatch(/if \(!row\) throw new Error/);
  });
});

describe("submit does not trust a caller-supplied leadId at face value", () => {
  it("createTechnicianReferral looks the lead up and only keeps leadId when it is a real careers-source lead", () => {
    const fn = DB_SRC.slice(
      DB_SRC.indexOf("export async function createTechnicianReferral"),
      DB_SRC.indexOf("export async function getTechnicianReferrals"),
    );
    expect(fn).toMatch(/\.from\(leads\)/);
    expect(fn).toMatch(/lead\.source !== "careers"/);
    expect(fn).toMatch(/leadId = null;/);
  });
});

describe("permissionForAdminProcedure covers technicianReferrals explicitly", () => {
  it("does NOT fall through to the fail-closed security.manage default on mutations", () => {
    expect(permissionForAdminProcedure("technicianReferrals.markPaid", "mutation")).toBe("leads.manage");
  });

  it("query and mutation resolve to the same, correct permission (leads.manage, not admin.view)", () => {
    expect(permissionForAdminProcedure("technicianReferrals.list", "query")).toBe("leads.manage");
    expect(permissionForAdminProcedure("technicianReferrals.markHired", "mutation")).toBe("leads.manage");
    expect(permissionForAdminProcedure("technicianReferrals.disqualify", "mutation")).toBe("leads.manage");
  });
});

describe("schema: status is VARCHAR, not ENUM — the nickstire-tidb-ddl rule", () => {
  it("technician_referrals.status is a varchar, matching the repo's status-column convention", () => {
    const table = SCHEMA_SRC.slice(
      SCHEMA_SRC.indexOf('export const technicianReferrals = mysqlTable("technician_referrals"'),
      SCHEMA_SRC.indexOf("export type TechnicianReferral"),
    );
    expect(table).toMatch(/status: varchar\("status", \{ length: 32 \}\)/);
    expect(table).not.toMatch(/status: mysqlEnum/);
  });
});

describe("the customer $25/$25 referral program is untouched by this feature", () => {
  it("the pre-existing referrals table/router is not renamed or removed", () => {
    expect(SCHEMA_SRC).toMatch(/export const referrals = mysqlTable\("referrals"/);
    expect(DB_SRC).toMatch(/export async function createReferral\(/);
    expect(DB_SRC).toMatch(/export async function getReferrals\(/);
  });
});

describe("Careers.tsx: the Google Jobs datePosted fix stays fixed, and referral submission never blocks the applicant", () => {
  it("JobPostingSchemas no longer regenerates datePosted from the current render time", () => {
    expect(CAREERS_SRC).not.toMatch(/datePosted: new Date\(\)\.toISOString\(\)/);
    expect(CAREERS_SRC).toMatch(/datePosted: pos\.datePosted,/);
  });

  it("every position declares a fixed datePosted string", () => {
    const positionBlocks = CAREERS_SRC.match(/schemaId: "[a-z-]+",\s*\n\s*datePosted: "\d{4}-\d{2}-\d{2}",/g);
    expect(positionBlocks?.length, "expected one datePosted per POSITIONS entry").toBe(3);
  });

  it("the referral mutation fires from lead.submit's onSuccess, so it can never block the applicant's own submission from completing", () => {
    const onSuccessBlock = CAREERS_SRC.slice(
      CAREERS_SRC.indexOf("onSuccess: (data) => {"),
      CAREERS_SRC.indexOf("onError: () => toast.error"),
    );
    expect(onSuccessBlock).toMatch(/setSubmitted\(true\);/);
    expect(onSuccessBlock.indexOf("setSubmitted(true);")).toBeLessThan(
      onSuccessBlock.indexOf("submitTechReferral.mutate"),
    );
  });

  it("the referrer's phone rides along in the durable lead fallback, not just their name", () => {
    // If technicianReferrals.submit hits migrationPending, the structured row
    // is never written and leads.problem is the only place this survives —
    // dropping the phone there would be a silent, permanent data loss.
    const problemTextBlock = CAREERS_SRC.slice(
      CAREERS_SRC.indexOf("const problemText = ["),
      CAREERS_SRC.indexOf("submitLead.mutate({"),
    );
    expect(problemTextBlock).toMatch(/form\.referredByPhone/);
  });
});

describe("migration 0121 is registered in the drizzle journal", () => {
  it("drizzle/meta/_journal.json has a 0121_technician_referrals entry, or db-migrate.ts will skip the table forever", () => {
    const journal = readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8");
    expect(journal).toMatch(/"0121_technician_referrals"/);
  });
});
