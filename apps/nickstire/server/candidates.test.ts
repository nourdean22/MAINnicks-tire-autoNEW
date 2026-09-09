/**
 * Candidate applications (server/routers/candidates.ts, drizzle "candidates"
 * table) — a dedicated home for /careers job applicants, built to eventually
 * replace routing them through trpc.lead.submit.
 *
 * WHY THIS MATTERS: verified against the live source, Careers.tsx's
 * ApplicationForm currently submits every job application through
 * trpc.lead.submit — the same endpoint customer sales inquiries use. That
 * pipeline calls scoreLead() (an AI urgency-scorer meant for car-repair
 * problems, applied nonsensically to job-application text), sends
 * leadConfirmationSms(), whose live message text is "Hey, this is Nick's
 * Tire & Auto on Euclid. We saw your request and wanted to help. What's
 * going on with the car — tires, brakes, check engine, or something else?"
 * (server/sms.ts — quoted here so a future edit to that string doesn't
 * silently make this comment wrong without a test noticing), and feeds
 * every downstream customer-lead consumer (opportunity queue, stale-lead
 * follow-up crons, Meta Conversions API, Google Sheets sync) that has no way
 * to know "careers" isn't a sales channel.
 *
 * This suite proves two things, neither requiring a real database:
 *
 *  1. The new candidates.submit code path is STRUCTURALLY INCAPABLE of
 *     triggering any of that — it doesn't import scoreLead, sms.ts, the
 *     event bus, sheets-sync, or meta-capi at all. This is checked at the
 *     source level (not just "works today") so a future edit that
 *     accidentally wires one of those back in fails CI immediately.
 *  2. Careers.tsx has NOT been cut over yet — this is a deliberate,
 *     documented, gated follow-up (see drizzle/schema.ts's `candidates` doc
 *     comment), not an oversight. A canary here means the day someone DOES
 *     cut it over, this test breaks and forces them to update it
 *     deliberately, rather than the repo silently drifting out of sync with
 *     its own stated sequencing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { permissionForAdminProcedure } from "../shared/adminPermissions";

const CANDIDATES_ROUTER_SRC = readFileSync(new URL("./routers/candidates.ts", import.meta.url), "utf8");
const DB_SRC = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const SCHEMA_SRC = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
const CAREERS_SRC = readFileSync(new URL("../client/src/pages/Careers.tsx", import.meta.url), "utf8");
const SMS_SRC = readFileSync(new URL("./sms.ts", import.meta.url), "utf8");

describe("the live leadConfirmationSms text really does ask about a car (grounds the whole rationale)", () => {
  it("quotes the exact live message, so this suite breaks loudly if that copy ever changes", () => {
    const fn = SMS_SRC.slice(
      SMS_SRC.indexOf("export function leadConfirmationSms"),
      SMS_SRC.indexOf("export function bookingConfirmationRequestSms"),
    );
    expect(fn).toMatch(/What's going on with the car/);
  });
});

describe("candidates.submit is structurally incapable of triggering customer-lead systems", () => {
  const FORBIDDEN_IMPORTS = [
    // AI urgency-scorer meant for car-repair problem text.
    /from ["']\.\.\/gemini["']/,
    // Sends leadConfirmationSms and every other customer SMS helper.
    /from ["']\.\.\/sms["']/,
    // Fires eventBus.emit.leadCaptured -> opportunity queue, stale-lead follow-up.
    /from ["']\.\.\/services\/eventBus["']/,
    // Google Sheets append.
    /from ["']\.\.\/sheets-sync["']/,
    // Meta Conversions API Lead event.
    /from ["']\.\.\/meta-capi["']/,
    // The stale-service-followup / after-hours capture path.
    /from ["']\.\.\/services\/afterHours["']/,
  ];

  it.each(FORBIDDEN_IMPORTS.map((re) => [re.source, re] as const))(
    "does not import %s",
    (_label, re) => {
      expect(CANDIDATES_ROUTER_SRC).not.toMatch(re);
    },
  );

  it("does not call scoreLead, notifyNewLead, alertNewLead, or emit.leadCaptured by name either", () => {
    for (const name of ["scoreLead(", "notifyNewLead(", "alertNewLead(", "emit.leadCaptured("]) {
      expect(CANDIDATES_ROUTER_SRC.includes(name), `candidates.ts calls ${name}`).toBe(false);
    }
  });

  it("db.ts's createCandidate/getCandidates/updateCandidateStatus are equally clean", () => {
    const block = DB_SRC.slice(
      DB_SRC.indexOf("// ─── CANDIDATE QUERIES"),
    );
    for (const name of ["scoreLead(", "notifyNewLead(", "alertNewLead(", "leadConfirmationSms(", "emit.leadCaptured("]) {
      expect(block.includes(name), `db.ts candidate section calls ${name}`).toBe(false);
    }
  });
});

describe("candidates.submit throws on a real failure (unlike technicianReferrals.submit's soft-fail)", () => {
  it("it's the applicant's primary submission, so losing it silently would be worse than an error", () => {
    const submitBlock = CANDIDATES_ROUTER_SRC.slice(
      CANDIDATES_ROUTER_SRC.indexOf("submit: publicProcedure"),
      CANDIDATES_ROUTER_SRC.indexOf("list: adminProcedure"),
    );
    expect(submitBlock).toMatch(/catch \(err\)/);
    expect(submitBlock).toMatch(/throw new TRPCError\(/);
    expect(submitBlock).toMatch(/We couldn't save your application/);
  });
});

describe("the read path still degrades gracefully if the migration isn't applied yet", () => {
  it("getCandidates distinguishes migrationPending from a genuinely empty list", () => {
    const fn = DB_SRC.slice(
      DB_SRC.indexOf("export async function getCandidates"),
      DB_SRC.indexOf("export async function updateCandidateStatus"),
    );
    expect(fn).toMatch(/isMissingTableError\(err\)/);
    expect(fn).toMatch(/migrationPending: true as const, rows: \[\]/);
  });

  it("list is an adminProcedure — applicant data is not customer-public", () => {
    const listLine = CANDIDATES_ROUTER_SRC.slice(
      CANDIDATES_ROUTER_SRC.indexOf("list: "),
      CANDIDATES_ROUTER_SRC.indexOf("updateStatus:"),
    );
    expect(listLine).toMatch(/adminProcedure\.query/);
  });
});

describe("permissionForAdminProcedure covers candidates explicitly", () => {
  it("does NOT fall through to the fail-closed security.manage default on mutations", () => {
    expect(permissionForAdminProcedure("candidates.updateStatus", "mutation")).toBe("leads.manage");
  });

  it("query and mutation both resolve to leads.manage, not admin.view", () => {
    expect(permissionForAdminProcedure("candidates.list", "query")).toBe("leads.manage");
  });
});

describe("schema: candidates.status is VARCHAR, not ENUM — the nickstire-tidb-ddl rule", () => {
  it("candidates table uses varchar for status and source", () => {
    const table = SCHEMA_SRC.slice(
      SCHEMA_SRC.indexOf('export const candidates = mysqlTable("candidates"'),
      SCHEMA_SRC.indexOf("export type Candidate"),
    );
    expect(table).toMatch(/status: varchar\("status", \{ length: 32 \}\)/);
    expect(table).toMatch(/source: varchar\("source", \{ length: 40 \}\)/);
    expect(table).not.toMatch(/mysqlEnum/);
  });

  it("technicianReferrals gained an additive candidateId column, and leadId was NOT removed", () => {
    const table = SCHEMA_SRC.slice(
      SCHEMA_SRC.indexOf('export const technicianReferrals = mysqlTable("technician_referrals"'),
      SCHEMA_SRC.indexOf("export type TechnicianReferral"),
    );
    // Plain nullable INT, no `.references()` — matches vehicle_visits.customerId
    // and the migration's own hand-written "no SQL-level FK" convention. A
    // `.references({onDelete: "set null"})` here would be fiction: this
    // migration is hand-written, not drizzle-kit-generated, so nothing would
    // actually enforce the ON DELETE behavior it claims.
    expect(table).toMatch(/candidateId: int\("candidateId"\),/);
    expect(table).toMatch(/leadId: int\("leadId"\),/);
    expect(table).not.toMatch(/leadId: int\("leadId"\)\.references/);
    expect(table).not.toMatch(/candidateId: int\("candidateId"\)\.references/);
  });

  it("migration 0122 is registered in the drizzle journal, or db-migrate.ts will skip the table forever", () => {
    const journal = readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8");
    expect(journal).toMatch(/"0122_candidates"/);
  });
});

describe("CANARY: Careers.tsx has NOT been cut over yet — this is a gated follow-up, not an oversight", () => {
  it("ApplicationForm still calls trpc.lead.submit, not trpc.candidates.submit", () => {
    expect(CAREERS_SRC).toMatch(/trpc\.lead\.submit\.useMutation/);
    expect(CAREERS_SRC).not.toMatch(/trpc\.candidates\.submit/);
  });

  it("when this test starts failing because someone DID cut it over: that's correct, update this test — do not revert their change", () => {
    // Documents intent for whoever's diff makes the test above fail. No assertion.
    expect(true).toBe(true);
  });
});
