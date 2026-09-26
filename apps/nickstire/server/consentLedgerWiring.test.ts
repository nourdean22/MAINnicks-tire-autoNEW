import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SERVER = import.meta.dirname;
const read = (rel: string) => readFileSync(join(SERVER, rel), "utf8");

describe("Q-43 consent ledger production wiring", () => {
  it("loads ledger revocations into the shared suppression index", () => {
    const sms = read("sms.ts");
    expect(sms).toContain('await import("./services/consentLedger")');
    expect(sms).toContain("ledger.snapshot.revokedSmsPhones");
    expect(sms).toContain("ledger.snapshot.heldPhones");
  });

  it("lets a later START-family inbound release an older message-log STOP", () => {
    const sms = read("sms.ts");
    expect(sms).toMatch(/NOT EXISTS[\s\S]*START','UNSTOP','YES'[\s\S]*mi\.createdAt > m\.createdAt/);
  });

  it("handles explicit inbound consent before customer suppression context with stable evidence identity", () => {
    const orchestrator = read("services/smsOrchestrator.ts");
    const responseJobs = read("services/smsResponseJobs.ts");
    const consentBlock = orchestrator.indexOf("Q-43: resolve explicit consent changes BEFORE suppression/context gates");
    const contextLoad = orchestrator.indexOf("ctx = await loadCustomerContext(normalizedPhone)");
    expect(consentBlock).toBeGreaterThan(-1);
    expect(contextLoad).toBeGreaterThan(consentBlock);
    expect(orchestrator).toContain('ledgerScope: "all"');
    expect(orchestrator).toContain('ledgerMethod: "sms_reply"');
    expect(orchestrator).toContain("event.idempotencyKey");
    expect(responseJobs).toContain("idempotencyKey: responseIdempotencyKey(input)");
    expect(responseJobs).toContain("idempotencyKey: `sms_response_job:${job.id}`");
  });

  it("attaches stable Vapi evidence and preserves Q-45 scope", () => {
    const vapi = read("routes/webhooks/vapi.ts");
    expect(vapi).toContain("evidenceRef: callId ? `vapi:${callId}` : undefined");
    expect(vapi).toContain('ledgerScope: scope === "all" ? "all" : "voice_ai_marketing"');
    expect(vapi).toContain('ledgerMethod: "voice_call"');
  });

  it("uses purpose-scoped ledger grants once ledger rollout is enabled", () => {
    const compliance = read("services/complianceLog.ts");
    expect(compliance).toContain("ledger.snapshot.grantsByPhone");
    expect(compliance).toContain('scopes.has("sms_marketing")');
    expect(compliance).toContain('ledgerMode !== "off"');
  });
});
