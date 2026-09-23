/**
 * The voice assistants must not promise what nothing tracks, and must not tell
 * a caller something happened that did not.
 *
 * 1. A timed callback ("promised 15 min callback") in any text the model reads
 *    is a deadline nobody measures. `tireInquiry.notes` once instructed exactly
 *    that, while the system prompt forbade it.
 * 2. Since 2026-06-05 an ordinary tire inquiry persists nothing but the call
 *    record (operator directive: no admin lead per caller), yet the caller was
 *    told "I've sent the tire info to the shop" — and walked in believing the
 *    counter had their size. The reply may say it was noted; never that it was
 *    sent.
 * 3. A spoken callback is only real if escalate() ran: it is the one tool that
 *    writes callback_requests AND the Promise Ledger row (voiceAgent.ts
 *    escalate). Every line of every script that promises a callback must route
 *    through escalate — including the implied ones ("let me have the manager
 *    confirm stock", "we'll look and call you with the estimate") and the ones
 *    outside the inbound prompt (follow-up, confirmation and recovery scripts,
 *    voicemails, and the strings the tools hand back for the model to relay).
 * 4. No promise names a person ("have him call you back"): nothing assigns the
 *    callback to anyone (inbound Critical Rule #2).
 *
 * Found by the 2026-09-23 customer-corpus research and its independent review
 * (docs/operations/CUSTOMER-CORPUS-RESEARCH-2026-09-23.md, Part C).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_SYSTEM_PROMPT,
  FOLLOW_UP_SYSTEM_PROMPT,
  VAPI_TOOLS,
  buildAssistantConfig,
  buildConfirmationVoicemail,
  buildFollowUpAssistantConfig,
  buildOutboundConfirmationPrompt,
  buildOutboundRecoveryPrompt,
  buildRecoveryVoicemail,
} from "../services/vapi";

type Param = { description?: string };
type Tool = { function?: { name?: string; description?: string; parameters?: { properties?: Record<string, Param> } } };

const describeTools = (tools: unknown): Array<{ where: string; text: string }> =>
  ((tools ?? []) as Tool[]).flatMap((t) => {
    const fn = t.function;
    if (!fn) return [];
    const params = Object.entries(fn.parameters?.properties ?? {}).map(([k, p]) => ({
      where: `${fn.name}.${k}`,
      text: p.description ?? "",
    }));
    return [{ where: fn.name ?? "?", text: fn.description ?? "" }, ...params];
  });
const followUpConfig = buildFollowUpAssistantConfig() as { voicemailMessage?: string; model?: { tools?: unknown } };
const toolTexts = () => [...describeTools(VAPI_TOOLS), ...describeTools(followUpConfig.model?.tools)];

/** Every script the model speaks from. */
const SCRIPTS: Array<[string, string]> = [
  ["inbound system prompt", ASSISTANT_SYSTEM_PROMPT],
  ["follow-up system prompt", FOLLOW_UP_SYSTEM_PROMPT],
  ["confirmation prompt", buildOutboundConfirmationPrompt({ customerName: "Jordan", service: "brake check", preferredDay: "tomorrow" })],
  ["recovery prompt", buildOutboundRecoveryPrompt({ customerName: "Jordan", service: "front brakes", amountDollars: 400 })],
  ["receptionist voicemail", String((buildAssistantConfig() as { voicemailMessage?: string }).voicemailMessage ?? "")],
  ["follow-up voicemail", String(followUpConfig.voicemailMessage ?? "")],
  ["confirmation voicemail", buildConfirmationVoicemail({ customerName: "Jordan", service: "brake check", preferredDay: "tomorrow" })],
  ["recovery voicemail", buildRecoveryVoicemail({ customerName: "Jordan", service: "front brakes" })],
];

// A closing quote or bracket can sit between the full stop and the space
// ('…a real answer." Never let…'); without it the next sentence's NEVER would
// exempt the promise before it — a false negative this split once had.
const sentences = (text: string) => text.split(/(?<=[.!?]["\u201d')]?)\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const lines = (text: string) => text.split(/\n+/).map((x) => x.trim()).filter(Boolean);

/**
 * An INSTRUCTION not to do it ("NEVER promise a callback", "Never send them to…
 * call back") is not a promise. Only that shape is exempt — a bare "no" is not
 * ("No worries — someone will call you back." is a promise).
 */
const INSTRUCTION_NEGATION = /\b(never|don'?t|do not|not)\s+(promise|say|tell|offer|claim|volunteer|give|send|ask)\b/i;

const NUM = String.raw`(?:\d+|five|ten|fifteen|twenty|thirty|forty-five|sixty)`;
const TIMED = new RegExp(
  String.raw`\b(?:in|within|under)\s+(?:an?\s+hour|the\s+hour|${NUM}\s*-?\s*(?:min(?:ute)?s?|hours?))\b` +
    String.raw`|\b${NUM}\s*-?\s*min(?:ute)?s?\b[^.]{0,20}\bcall\s*-?\s*back` +
    String.raw`|\bcall\s*-?\s*back\b[^.]{0,20}\b${NUM}\s*-?\s*min`,
  "i",
);
const CONTACT = /\b(call|calls|callback|text|texts|get\s+back|reach|hear\s+(?:from|back))\b/i;
const timedPromises = (text: string) =>
  sentences(text).filter((x) => TIMED.test(x) && CONTACT.test(x) && !INSTRUCTION_NEGATION.test(x));

const CALLBACK_PROMISE = new RegExp(
  [
    String.raw`\bcalls?\s+you\s+(?:right\s+)?(?:back|with|once|when|later|tomorrow)\b`,
    String.raw`\bgive\s+you\s+a\s+(?:call|ring)\b`,
    String.raw`\bgets?\s+back\s+to\s+you\b`,
    String.raw`\b(?:be|get)\s+in\s+touch\b`,
    String.raw`\breach\s+out\s+to\s+you\b`,
    String.raw`\bsomeone\s+(?:can|will|'ll)\s+(?:follow\s*-?\s*up|call|text|reach)\b`,
    String.raw`\bfollow\s*-?\s*up\s+with\s+you\b`,
    // implied: a named role will do something and, by implication, come back
    String.raw`\b(?:have|get)\s+(?:the|a|our)\s+(?:manager|owner|shop|team|tech|technician|counter)\b[^.]{0,40}\b(?:confirm|check|look|call|get\s+back)\b`,
  ].join("|"),
  "i",
);
/** A line (one flow step, one bullet) that promises a callback must route it through escalate. */
const untrackedCallbackPromises = (text: string) =>
  lines(text).flatMap((line) =>
    /\bescalate\b/.test(line) ? [] : sentences(line).filter((x) => CALLBACK_PROMISE.test(x) && !INSTRUCTION_NEGATION.test(x)),
  );
const NAMED_CALLBACK = /\b(?:have|get)\s+(?:him|her|nick|mo|moe)\b[^.]{0,20}\b(?:call|text|get\s+back)|\bnick\s+(?:will|'ll)\s+(?:call|text|get\s+back)/i;
const HOMEWORK = /\b(check|look at|read)\b[^.]{0,40}\b(sidewall|side of (?:any|the|your)|door jamb|sticker)\b/i;
const homework = (text: string) => sentences(text).filter((x) => HOMEWORK.test(x) && !INSTRUCTION_NEGATION.test(x));

describe("POSITIVE CONTROLS: each matcher catches the text that shipped", () => {
  it("timed promises", () => {
    expect(timedPromises("Use 'PHYSICAL RACK CHECK REQUESTED — promised 15 min callback' when…")).toHaveLength(1);
    expect(timedPromises("We'll call you back in 15 minutes.")).toHaveLength(1);
    expect(timedPromises("Someone will get back to you within the hour.")).toHaveLength(1);
    expect(timedPromises("Tell them a fifteen-minute callback is coming.")).toHaveLength(1);
    // …and passes an instruction not to, and a duration that is not a promise
    expect(timedPromises("Never promise a 15 min callback.")).toHaveLength(0);
    expect(timedPromises("Keep it under 3 minutes.")).toHaveLength(0);
  });

  it("untracked callback promises, explicit and implied", () => {
    // the pre-fix FLOW 1 odd-size line: an implied callback, no escalate
    expect(untrackedCallbackPromises('- ODD/uncommon (24"+ rims, run-flats, oversized): "Less common for us — let me have the manager confirm stock. Name and best number?" → tireInquiry → transferCall only if they want to talk now (OPEN).')).toHaveLength(1);
    // the pre-fix towed-vehicle confirm (bookSlot writes no promise row)
    expect(untrackedCallbackPromises('Confirm: "car\'s at {location}, sending it to 17625 Euclid Ave — soon as it lands we\'ll look and call you with the estimate." → bookSlot → transferCall.')).toHaveLength(1);
    // the pre-fix voicemail and the unregistered quoteRange note
    expect(untrackedCallbackPromises("We didn't reach you — leave us your name and tire size, we'll call you back. (216) 862-0005.")).toHaveLength(1);
    expect(untrackedCallbackPromises("I'm not sure about that exact service — let me have someone call you back with a quote.")).toHaveLength(1);
    // a bare "no" does not exempt a promise
    expect(untrackedCallbackPromises("No worries — someone will call you back.")).toHaveLength(1);
    // …and passes a line that escalates, and an instruction not to promise
    expect(untrackedCallbackPromises('Get name + phone, call escalate({ name, phone }), say "someone calls you back when we\'re open."')).toHaveLength(0);
    expect(untrackedCallbackPromises("NEVER promise a callback or a timeframe.")).toHaveLength(0);
  });

  it("named-person callbacks and sidewall homework", () => {
    expect(NAMED_CALLBACK.test("Want me to have him call you back instead?")).toBe(true);
    expect(NAMED_CALLBACK.test("Nick will call Jordan back.")).toBe(true);
    expect(NAMED_CALLBACK.test("Want me to have someone from the shop call you back instead?")).toBe(false);
    expect(homework("Trim level may change the size — check the door jamb sticker if you can.")).toHaveLength(1);
    expect(homework("Easiest answer: check the side of any current tire on your vehicle for the size.")).toHaveLength(1);
    expect(homework("Never send them to check a sidewall or door jamb and call back.")).toHaveLength(0);
  });
});

describe("every script and tool text the model reads promises nothing untracked", () => {
  it.each(SCRIPTS)("%s: no timed promise, no callback without escalate, no named person", (_where, text) => {
    expect(text.length).toBeGreaterThan(20);
    expect(timedPromises(text)).toEqual([]);
    expect(untrackedCallbackPromises(text)).toEqual([]);
    expect(text).not.toMatch(NAMED_CALLBACK);
  });

  it("no tool or parameter description carries a timed or untracked callback promise", () => {
    const texts = toolTexts();
    expect(texts.length).toBeGreaterThan(10);
    expect(texts.filter(({ text }) => timedPromises(text).length > 0).map(({ where }) => where)).toEqual([]);
    expect(texts.filter(({ text }) => untrackedCallbackPromises(text).length > 0).map(({ where }) => where)).toEqual([]);
  });

  it("tireInquiry no longer claims a lead is saved or that the counter sees its notes", () => {
    const texts = toolTexts();
    const d = texts.find((t) => t.where === "tireInquiry")?.text ?? "";
    expect(d).not.toBe("");
    expect(d).not.toMatch(/lead saved/i);
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(/lead saved/i);
    expect(texts.find((t) => t.where === "tireInquiry.notes")?.text).toMatch(/NOT shown to the counter/);
    // tireInquiry does not reach the person on a transfer (the whisper is fixed text)
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(/so the human gets context/i);
  });

  it("no commitment the ledger or the shop does not back: 'first thing when we open', 'that quote's still good'", () => {
    // escalate's promise is due at the END of the next open period (nextCloseAt,
    // voiceAgent.ts escalate); "first thing" is a stricter promise than the one
    // the ledger holds the shop to, so a 5:55 PM callback would score as kept.
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(/first thing when we open/i);
    // No rule makes a 5-6-week-old quote binding; the recovery lane must not say it is.
    for (const [where, text] of SCRIPTS) expect([where, /quote('?s| is)\s+still\s+good/i.test(text)]).toEqual([where, false]);
  });

  it("escalate is allowed for CALLBACK CAPTURE during open hours, not only when closed", () => {
    const d = toolTexts().find((t) => t.where === "escalate")?.text ?? "";
    expect(d).not.toBe("");
    expect(d).toMatch(/CALLBACK CAPTURE/);
    expect(d).not.toMatch(/Never during open hours/i);
  });

  it("the escalate tool response does not name a person who will call back", () => {
    // The model relays tool responses. Nothing assigns the callback to a person.
    const src = readFileSync(join(process.cwd(), "server/routers/voiceAgent.ts"), "utf-8");
    expect(src).not.toMatch(/Nick will call/);
  });
});

/**
 * What the tools hand back is what the caller hears: the model relays it. So
 * the replies are checked by CALLING the procedures, not by reading a helper —
 * putting "I've sent the tire info to the shop" back into the router must fail
 * here (it did not when only the helper was tested).
 */
describe("what the tools say back", () => {
  afterEach(() => {
    vi.doUnmock("../lib/db-helper");
    vi.resetModules();
  });

  async function voiceCaller() {
    // The ordinary inquiry needs a connection handle and nothing else: it
    // writes no row. Any query against this stub would throw.
    vi.doMock("../lib/db-helper", () => ({ db: async () => ({}) }));
    const { voiceAgentRouter } = await import("../routers/voiceAgent");
    return voiceAgentRouter.createCaller({
      user: null,
      isVoiceAgentInternal: true,
      req: { protocol: "https", headers: {} },
      res: { clearCookie: () => {} },
    } as never);
  }

  it("an ordinary tire inquiry is 'noted', never 'sent to the shop', and echoes the size back", async () => {
    const c = await voiceCaller();
    for (const tireSize of ["225/65R17", undefined]) {
      const res = await c.tireInquiry({ name: "Jordan Example", phone: "2165550100", tireSize });
      expect(res.success).toBe(true);
      expect(res.message).not.toMatch(/sent\b[^.]{0,30}\bshop/i);
      expect(res.message).toMatch(/noted/i);
      expect(untrackedCallbackPromises(res.message)).toEqual([]);
      if (tireSize) expect(res.message).toContain(tireSize);
    }
  });

  it("tireSizeFromVehicle gives no sidewall homework, no call-back, and no price range — found or not", async () => {
    const c = await voiceCaller();
    for (const q of [{ year: 2019, make: "Honda", model: "Civic" }, { year: 1987, make: "Yugo", model: "GV" }]) {
      const res = (await c.tireSizeFromVehicle(q)) as Record<string, unknown>;
      const note = String(res.note ?? "");
      expect(note).not.toBe("");
      expect(homework(note)).toEqual([]);
      expect(untrackedCallbackPromises(note)).toEqual([]);
      expect(res).not.toHaveProperty("usedTirePriceRange");
    }
  });

  it("quoteRange (unregistered, still dispatchable) promises no callback", async () => {
    const c = await voiceCaller();
    const res = await c.quoteRange({ service: "flux capacitor realignment" });
    expect(res.shouldEscalate).toBe(true);
    expect(untrackedCallbackPromises(String(res.sourceNote))).toEqual([]);
  });

  it("checkTireStock's hint gives no timeframe and routes any callback through escalate", async () => {
    const c = await voiceCaller();
    const res = await c.checkTireStock({ tireSize: "305/35R24" });
    expect(timedPromises(res.aiHint)).toEqual([]);
    expect(res.aiHint).toMatch(/escalate/);
  });
});
