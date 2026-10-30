/**
 * Text-to-apply (job 2026-10-30-tech-hiring-page, W1).
 *
 * The careers pages carry a tap-to-text button whose prefilled body starts with
 * the exact token "JOB-APPLY". That text lands on the shop line, where every
 * inbound goes to the customer reply bot. These tests pin the routing rule:
 *   - the token, and ONLY the token, records a candidate and fires the owner
 *     alert, with no reply sent to the applicant (an auto-reply is a send);
 *   - CONTROL: a customer text that merely mentions a job, a tech or hiring
 *     still reaches the normal customer flow;
 *   - STOP inside a token text still reaches the orchestrator, which owns
 *     opt-out handling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  orchestrate: vi.fn(),
  createCandidate: vi.fn(),
  intake: vi.fn(),
}));

// getDb() → null: the job table is "unavailable", so handleInboundResponse
// takes the degraded in-process path, and runResponseJob's status writes no-op.
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  createCandidate: (...a: unknown[]) => h.createCandidate(...a),
  findCandidatesByPhoneE164: vi.fn().mockResolvedValue({ available: true, rows: [] }),
  getCandidateSendBudget: vi.fn().mockResolvedValue({ available: true, last24h: 0, sameEmail24h: 0, samePhone24h: 0 }),
}));
vi.mock("./services/smsOrchestrator", () => ({
  orchestrateSms: (...a: unknown[]) => h.orchestrate(...a),
}));
vi.mock("./services/candidateIntake", () => ({
  runCandidateIntake: (...a: unknown[]) => h.intake(...a),
}));

import { handleInboundResponse, runResponseJob } from "./services/smsResponseJobs";

const PHONE = "+12165550142";
const inbound = (body: string) => ({ conversationId: 9, phone: PHONE, providerMsgId: `SM-${body.length}`, body });

beforeEach(() => {
  h.orchestrate.mockReset().mockResolvedValue({ id: 1, status: "sent", shouldAutoSend: true });
  h.createCandidate.mockReset().mockResolvedValue({ success: true, id: 77, columns0129: true });
  h.intake.mockReset().mockResolvedValue(undefined);
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

  it("the durable job runner takes the same branch", async () => {
    await runResponseJob({ id: 5, conversationId: 9, customerPhone: PHONE, body: "JOB-APPLY Service Advisor. My name is Ana", attempts: 1 });
    expect(h.orchestrate).not.toHaveBeenCalled();
    expect(h.createCandidate).toHaveBeenCalledTimes(1);
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
  });

  it("STOP inside a token text still reaches the orchestrator (opt-out wins)", async () => {
    await handleInboundResponse(inbound("JOB-APPLY Automotive Technician STOP"));
    expect(h.orchestrate).toHaveBeenCalledTimes(1);
    expect(h.createCandidate).not.toHaveBeenCalled();
  });
});
