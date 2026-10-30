/**
 * Text-to-apply (job 2026-10-30-tech-hiring-page, W1).
 *
 * The careers pages carry a tap-to-text button whose prefilled body starts with
 * the exact token "JOB-APPLY". That text lands on the shop line, where every
 * inbound goes to the customer reply bot. These tests pin the routing rule:
 *   - the token, and ONLY the token, records a candidate and fires the owner
 *     alert, with no reply sent to the applicant (an auto-reply is a send);
 *   - a token text that is also an opt-out is RECORDED as an opt-out, and an
 *     applicant who writes "stop by" or "quit my shop" is still an applicant;
 *   - one row per inbound text, even when the job re-runs;
 *   - CONTROL: a customer text that merely mentions a job, a tech or hiring
 *     still reaches the normal customer flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({
  orchestrate: vi.fn(),
  createCandidate: vi.fn(),
  findBySession: vi.fn(),
  intake: vi.fn(),
  notSaved: vi.fn(),
  optOut: vi.fn(),
  ledger: vi.fn(),
  db: null as null | { execute: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> },
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => h.db),
  createCandidate: (...a: unknown[]) => h.createCandidate(...a),
  findCandidateIdBySessionId: (...a: unknown[]) => h.findBySession(...a),
  findCandidatesByPhoneE164: vi.fn().mockResolvedValue({ available: true, rows: [] }),
  getCandidateSendBudget: vi.fn().mockResolvedValue({ available: true, last24h: 0, sameEmail24h: 0, samePhone24h: 0 }),
}));
vi.mock("./services/smsOrchestrator", () => ({
  orchestrateSms: (...a: unknown[]) => h.orchestrate(...a),
}));
vi.mock("./services/candidateIntake", () => ({
  runCandidateIntake: (...a: unknown[]) => h.intake(...a),
  notifyOwnerTextApplicationNotSaved: (...a: unknown[]) => h.notSaved(...a),
}));
vi.mock("./sms", () => ({ markPhoneFullyOptedOut: (...a: unknown[]) => h.optOut(...a) }));
vi.mock("./services/complianceLog", () => ({ logSmsOptOut: (...a: unknown[]) => h.ledger(...a) }));

import { handleInboundResponse, runResponseJob } from "./services/smsResponseJobs";

const PHONE = "+12165550142";
const inbound = (body: string) => ({ conversationId: 9, phone: PHONE, providerMsgId: `SM-${body.length}`, body });
const job = (body: string, attempts = 1) => ({ id: 5, conversationId: 9, customerPhone: PHONE, body, attempts });

/** Status writes the runner made, read from the real SQL it sent. */
function statusWrites(): Array<{ status: unknown; lastError: unknown; id: unknown }> {
  const dialect = new MySqlDialect();
  return (h.db?.execute.mock.calls ?? [])
    .map((c) => dialect.sqlToQuery(c[0] as SQL))
    .filter((q) => q.sql.includes("UPDATE sms_response_jobs") && q.sql.includes("lastError"))
    .map((q) => ({ status: q.params[0], lastError: q.params[2], id: q.params[q.params.length - 1] }));
}

beforeEach(() => {
  h.db = null;
  h.orchestrate.mockReset().mockResolvedValue({ id: 1, status: "sent", shouldAutoSend: true });
  h.createCandidate.mockReset().mockResolvedValue({ success: true, id: 77, columns0129: true });
  h.findBySession.mockReset().mockResolvedValue(null);
  h.intake.mockReset().mockResolvedValue(undefined);
  h.notSaved.mockReset().mockResolvedValue(undefined);
  h.optOut.mockReset().mockResolvedValue(true);
  h.ledger.mockReset().mockResolvedValue(undefined);
});

describe("text-to-apply token routes to hiring, never to the customer bot", () => {
  it("records a candidate, fires the owner alert and sends no reply", async () => {
    await handleInboundResponse(inbound("JOB-APPLY Automotive Technician. My name is Mike Rivera"));

    expect(h.orchestrate).not.toHaveBeenCalled();
    expect(h.createCandidate).toHaveBeenCalledTimes(1);
    const row = h.createCandidate.mock.calls[0][0];
    expect(row.source).toBe("sms");
    expect(row.phone).toBe(PHONE);
    expect(row.positionTitle).toBe("Automotive Technician");
    expect(row.name).toBe("Mike Rivera");
    expect(row.sessionId).toMatch(/^smsin:[0-9a-f]{24}$/);
    await vi.waitFor(() => expect(h.intake).toHaveBeenCalledTimes(1));
    expect(h.intake.mock.calls[0][0]).toMatchObject({ id: 77, intent: "apply", email: null });
  });

  it("matches the token case-insensitively with leading space, and an untouched body still saves", async () => {
    await handleInboundResponse(inbound("  job-apply Tire / Hybrid Technician. My name is "));
    expect(h.orchestrate).not.toHaveBeenCalled();
    const row = h.createCandidate.mock.calls[0][0];
    expect(row.positionTitle).toBe("Tire / Hybrid Technician");
    expect(row.name.length).toBeGreaterThan(0);
  });

  it("an unknown role still saves, with no position", async () => {
    await handleInboundResponse(inbound("JOB-APPLY painter. My name is Sam"));
    expect(h.orchestrate).not.toHaveBeenCalled();
    expect(h.createCandidate.mock.calls[0][0].positionTitle).toBeNull();
  });

  it.each([
    "JOB-APPLY Automotive Technician. My name is Mike, I can stop by Monday",
    "JOB-APPLY Tire / Hybrid Technician. My name is Ray. I will quit my current shop in two weeks",
  ])("an applicant who writes 'stop by' or 'quit' is still an applicant: %s", async (body) => {
    await handleInboundResponse(inbound(body));
    expect(h.createCandidate).toHaveBeenCalledTimes(1);
    expect(h.optOut).not.toHaveBeenCalled();
    expect(h.orchestrate).not.toHaveBeenCalled();
  });
});

describe("a token text that is an opt-out is recorded as one, and answered with nothing", () => {
  it.each([
    "JOB-APPLY Automotive Technician STOP",
    "JOB-APPLY Automotive Technician. stop.",
    "JOB-APPLY please unsubscribe",
    "JOB-APPLY STOPALL",
    "JOB-APPLY revoke",
    "JOB-APPLY opt out",
    "JOB-APPLY opt-out please",
    "JOB-APPLY Service Advisor. stop texting me",
    "JOB-APPLY stop all of it",
  ])("%s", async (body) => {
    await handleInboundResponse(inbound(body));
    expect(h.optOut).toHaveBeenCalledWith(PHONE);
    expect(h.ledger).toHaveBeenCalledTimes(1);
    expect(h.ledger.mock.calls[0][0]).toMatchObject({ phone: PHONE, via: "keyword", ledgerScope: "all", ledgerMethod: "sms_reply" });
    expect(String(h.ledger.mock.calls[0][0].evidenceRef)).toMatch(/^sms:resp:/);
    expect(h.createCandidate).not.toHaveBeenCalled();
    expect(h.orchestrate).not.toHaveBeenCalled();
  });
});

describe("durable job runner", () => {
  beforeEach(() => {
    h.db = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]), update: vi.fn() };
  });

  it("saves keyed to the job and marks the job suppressed", async () => {
    await runResponseJob(job("JOB-APPLY Service Advisor. My name is Ana"));
    expect(h.orchestrate).not.toHaveBeenCalled();
    expect(h.findBySession).toHaveBeenCalledWith("smsjob:5");
    expect(h.createCandidate.mock.calls[0][0].sessionId).toBe("smsjob:5");
    expect(statusWrites()).toEqual([{ status: "suppressed", lastError: null, id: 5 }]);
  });

  it("a re-run of the same job finds the saved row: no second row, no second alert", async () => {
    h.findBySession.mockResolvedValue(77);
    await runResponseJob(job("JOB-APPLY Service Advisor. My name is Ana", 2));
    expect(h.createCandidate).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.intake).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([{ status: "suppressed", lastError: null, id: 5 }]);
  });

  it("a failed save re-queues with a log-safe error, then goes dead at the last attempt; the bot is never called", async () => {
    // drizzle's wrapper puts the bound params (name, phone, the text) in its message.
    const leaky = Object.assign(new Error("Failed query: insert ... params: Ana,+12165550142,JOB-APPLY"), {
      cause: Object.assign(new Error("driver"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }),
    });
    h.createCandidate.mockRejectedValue(leaky);

    await runResponseJob(job("JOB-APPLY Service Advisor. My name is Ana", 1));
    await runResponseJob(job("JOB-APPLY Service Advisor. My name is Ana", 5));

    const writes = statusWrites();
    expect(writes.map((w) => w.status)).toEqual(["pending", "dead"]);
    for (const w of writes) {
      expect(String(w.lastError)).toContain("text application not saved (insert)");
      expect(String(w.lastError)).toContain("1205");
      expect(String(w.lastError)).not.toMatch(/Ana|5550142|params/);
    }
    expect(h.orchestrate).not.toHaveBeenCalled();
  });
});

describe("no-job fallback", () => {
  it("a failed save sends the owner one internal text with the last four digits only", async () => {
    h.createCandidate.mockResolvedValue({ success: false, migrationPending: true });
    await handleInboundResponse(inbound("JOB-APPLY Automotive Technician. My name is Lee"));
    expect(h.notSaved).toHaveBeenCalledWith("0142");
    expect(h.orchestrate).not.toHaveBeenCalled();
  });
});

describe("contract: what the page prefills is what the server routes", () => {
  // The body is read back out of the real href the buttons render, so a change
  // to either side (prefill or routing) breaks this test.
  const bodyOf = (href: string) => decodeURIComponent(href.split("?&body=")[1]);

  it("every open role's button body saves an application for that role", async () => {
    const { openJobOpenings, hiringSmsHref } = await import("@shared/jobOpenings");
    for (const j of openJobOpenings()) {
      h.createCandidate.mockClear();
      const href = hiringSmsHref("2168620005", j.title);
      expect(href.startsWith("sms:2168620005?&body=")).toBe(true);
      await handleInboundResponse(inbound(`${bodyOf(href)}Lee`));
      expect(h.createCandidate).toHaveBeenCalledTimes(1);
      expect(h.createCandidate.mock.calls[0][0]).toMatchObject({ positionTitle: j.title, name: "Lee" });
    }
    expect(h.orchestrate).not.toHaveBeenCalled();
  });

  it("the hub's role-less button also routes, with no position", async () => {
    const { hiringSmsHref } = await import("@shared/jobOpenings");
    await handleInboundResponse(inbound(`${bodyOf(hiringSmsHref("2168620005"))}Lee`));
    expect(h.orchestrate).not.toHaveBeenCalled();
    expect(h.createCandidate.mock.calls[0][0]).toMatchObject({ positionTitle: null, name: "Lee" });
  });
});

describe("CONTROL: customer texts without the token keep the normal flow", () => {
  it.each([
    "Is my job done yet?",
    "do you have any job openings for a tech",
    "Are you hiring?",
    "JOB: brakes and rotors, how much",
    "My tech said the job needs another part",
    "JOBAPPLY",
    "please apply the coupon JOB-APPLY to my invoice",
  ])("%s → orchestrator, no candidate", async (body) => {
    await handleInboundResponse(inbound(body));
    expect(h.orchestrate).toHaveBeenCalledTimes(1);
    expect(h.createCandidate).not.toHaveBeenCalled();
    expect(h.optOut).not.toHaveBeenCalled();
  });
});
