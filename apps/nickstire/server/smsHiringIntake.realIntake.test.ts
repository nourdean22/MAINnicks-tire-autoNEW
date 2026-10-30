/**
 * Text-to-apply through the REAL candidate intake (only the send layers are
 * mocked): exactly one text goes out, to the owner, from the store line as an
 * internal message; nothing goes to the applicant's phone, and no
 * acknowledgement email is attempted (a text applicant has no email).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ sendSms: vi.fn(), notify: vi.fn(), orchestrate: vi.fn() }));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  createCandidate: vi.fn(async () => ({ success: true, id: 501, columns0129: true })),
  findCandidateIdBySessionId: vi.fn(async () => null),
  findCandidatesByPhoneE164: vi.fn(async () => ({ available: true, rows: [] })),
  getCandidateSendBudget: vi.fn(async () => ({ available: true, last24h: 0, sameEmail24h: 0, samePhone24h: 0 })),
  markCandidateOwnerAlerted: vi.fn(async () => undefined),
}));
vi.mock("./sms", () => ({ sendSms: (...a: unknown[]) => h.sendSms(...a) }));
vi.mock("./email-notify", () => ({ sendNotification: (...a: unknown[]) => h.notify(...a) }));
vi.mock("./services/smsOrchestrator", () => ({ orchestrateSms: (...a: unknown[]) => h.orchestrate(...a) }));

import { handleInboundResponse } from "./services/smsResponseJobs";
import { detachedWork } from "./_core/gracefulShutdown";

const APPLICANT = "+12165550142";
let saved: { phone?: string; sms?: string };

beforeEach(() => {
  saved = { phone: process.env.CANDIDATE_ALERT_PHONE, sms: process.env.CANDIDATE_OWNER_SMS };
  process.env.CANDIDATE_ALERT_PHONE = "+12165550199";
  delete process.env.CANDIDATE_OWNER_SMS;
  h.sendSms.mockReset().mockResolvedValue({ success: true });
  h.notify.mockReset().mockResolvedValue(true);
  h.orchestrate.mockReset();
});

afterEach(() => {
  if (saved.phone === undefined) delete process.env.CANDIDATE_ALERT_PHONE;
  else process.env.CANDIDATE_ALERT_PHONE = saved.phone;
  if (saved.sms === undefined) delete process.env.CANDIDATE_OWNER_SMS;
  else process.env.CANDIDATE_OWNER_SMS = saved.sms;
});

describe("text-to-apply · real candidate intake", () => {
  it("one internal text to the owner, none to the applicant, no applicant email", async () => {
    await handleInboundResponse({
      conversationId: 3,
      phone: APPLICANT,
      providerMsgId: "SM-real-1",
      body: "JOB-APPLY Automotive Technician. My name is Lee",
    });
    await detachedWork.settled();

    expect(h.orchestrate).not.toHaveBeenCalled();
    expect(h.sendSms).toHaveBeenCalledTimes(1);
    const [to, , opts] = h.sendSms.mock.calls[0];
    expect(to).toBe("+12165550199");
    expect(opts).toMatchObject({ via: "shop", messageClass: "internal" });
    expect(h.sendSms.mock.calls.some((c) => String(c[0]).includes("5550142"))).toBe(false);
    // The owner email may go out; the applicant acknowledgement never does.
    const templates = h.notify.mock.calls.map((c) => (c[0] as { templateUsed?: string }).templateUsed);
    expect(templates).not.toContain("candidate_applicant_ack");
    expect(h.notify.mock.calls.every((c) => !(c[0] as { overrideTo?: unknown }).overrideTo)).toBe(true);
  });
});
