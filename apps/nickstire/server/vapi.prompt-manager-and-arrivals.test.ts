/**
 * 2026-10-21 · Nour: no name/number questions before a transfer (caller ID has
 * the number), and "coming now / tow coming" is a text to the shop, not a row.
 * Pins the prompt, the two tool schemas and the success grade to that, and pins
 * the caller-audible lines this change was told to leave alone.
 */
import { describe, expect, it } from "vitest";
import { ASSISTANT_SYSTEM_PROMPT, VAPI_TOOLS, buildAssistantConfig } from "./services/vapi";
import { sliceBlock } from "./testUtils/sourceBlock";

type Tool = { type?: string; function?: { name?: string; description?: string; parameters?: { required?: string[]; properties?: Record<string, { description?: string }> } } };
const tool = (name: string) => (VAPI_TOOLS as unknown as Tool[]).find((t) => t.function?.name === name)!.function!;
const section = (start: string, end: string) => sliceBlock(ASSISTANT_SYSTEM_PROMPT, start, end, { label: "ASSISTANT_SYSTEM_PROMPT" });

describe("no questions before a transfer or a callback", () => {
  it.each([
    "PHONE-CAPTURE-BEFORE-TRANSFER",
    "best number in case we get disconnected",
    "Get name + phone + need",
    "Capture name + phone + vehicle + issue",
    "capture name + number and call escalate",
    "escalate with name + phone",
    "phone-capture once",
  ])("the prompt no longer says %j", (old) => {
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain(old);
  });

  it("says NO QUESTIONS BEFORE A TRANSFER and the closed path asks only what it's about", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("NO QUESTIONS BEFORE A TRANSFER");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("Don't ask for their name or number: caller ID has the number.");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("OPEN → transferCall right away, no questions");
  });

  it("escalate requires only a reason and is told caller ID supplies the number", () => {
    const esc = tool("escalate");
    expect(esc.parameters?.required).toEqual(["reason"]);
    expect(esc.description).toContain("needs_number:true");
    expect(esc.parameters?.properties?.phone?.description).toMatch(/Caller ID is used otherwise/);
  });

  it("a callback is promised only on success:true", () => {
    expect(section("## CALLBACK CAPTURE", "\n\n")).toContain("only when it returns success:true");
  });
});

describe("coming now / tow coming is a heads-up text", () => {
  it("bookSlot requires name + service only and takes an eta", () => {
    const bs = tool("bookSlot");
    expect(bs.parameters?.required).toEqual(["name", "service"]);
    expect(bs.parameters?.properties?.eta).toBeDefined();
    expect(bs.parameters?.properties?.phone?.description).toMatch(/never ask for it/);
  });

  it("the tow flow passes eta and no longer requires a phone capture", () => {
    const tow = section("## BROKEN-DOWN / TOWED", "\n\n");
    expect(tow).toContain('bookSlot({ name, service: "tow incoming — <what happened>", vehicle, eta })');
    expect(tow).not.toContain("name + phone + vehicle");
    expect(tow).toContain("Don't let them off the line without name + vehicle.");
  });

  it("FLOW 2 books with eta, not phone", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("→ bookSlot({ name, service, vehicle, eta }) → sendConfirmationSms");
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("bookSlot({ name, phone, service, vehicle })");
  });

  it("the success grade no longer fails a call for not capturing name/phone", () => {
    const cfg = buildAssistantConfig() as unknown as { analysisPlan: { successEvaluationPlan: { messages: Array<{ content: string }> } } };
    const grade = cfg.analysisPlan.successEvaluationPlan.messages.map((m) => m.content).join("\n");
    expect(grade).toContain("customer asked for human and didn't get one");
    expect(grade).not.toContain("failed to capture name/phone");
  });
});

describe("out-of-scope caller lines stay as they were", () => {
  it.each([
    "What's your name and best number for the shop?",
    "Pull up today, we'll get you taken care of — what's your name and best number?",
    "FCFS — come by today? What's your name and best number?",
    "→ name → best number → bookSlot({ service: \"flat tire repair\", preferredDay: \"today\" })",
    "Switch to simple Spanish/Arabic. If it gets complex, capture phone + transferCall.",
    "→ sendConfirmationSms → transferCall (if the transfer fails, the shop already has the text).",
  ])("still contains %j", (line) => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(line);
  });

  it("tireInquiry still requires its own fields", () => {
    expect(tool("tireInquiry").parameters?.required).toContain("phone");
  });
});
