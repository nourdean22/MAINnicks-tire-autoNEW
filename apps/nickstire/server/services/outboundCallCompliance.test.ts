/**
 * Q-45 · every outbound AI-voice call carries the 47 CFR 64.1200(b) content.
 *
 *   (b)(1) business identity at the BEGINNING of the message
 *   (b)(2) the shop's callback number during or after it
 *   (b)(3) sales calls: an automated voice opt-out, with instructions, within
 *          two seconds of the identification; using it records the number and
 *          ENDS the call; a sales voicemail needs a toll-free opt-out number,
 *          which the shop does not have — so a sales lane leaves none.
 *
 * Asserted on the REAL POST /call body `placeVapiOutboundCall` builds for each
 * lane (fetch stubbed, 555 numbers, canary env), not on a re-typed copy. The
 * lane sweep at the bottom pins which lane name each dialling file passes, so
 * a lane cannot quietly reclassify itself as informational.
 *
 * RED ON MAIN: `outboundCallCompliance.ts` does not exist there, and the lanes
 * passed a bare "Hey Pat, it's Nick's Tire — …" first message with no number,
 * no opt-out and (on sales lanes) a voicemail.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUSINESS } from "@shared/business";
import {
  CALLBACK_NUMBER,
  customerUtterances,
  DO_NOT_CALL_TOOL_NAME,
  isSalesLane,
  isSpokenOptOut,
  spokenOptOutScope,
  SPOKEN_BUSINESS_NAME,
  type OutboundLane,
} from "./outboundCallCompliance";

type Body = {
  assistantOverrides: {
    firstMessage: string;
    voicemailMessage: string;
    voicemailDetection?: { enabled?: boolean };
    model: { messages: Array<{ content: string }>; tools: Array<Record<string, unknown>> };
  };
};

// Every member of OutboundLane; `satisfies` makes the compiler reject a lane
// added to the type but not listed here.
const LANE_SET = { voice_recovery: 1, followup_cadence: 1, followup_manual: 1, confirmation: 1 } satisfies Record<OutboundLane, 1>;
const LANES = Object.keys(LANE_SET) as OutboundLane[];
const SALES = LANES.filter(isSalesLane);

describe("the words come from the shared business constants", () => {
  it("identity and callback number are BUSINESS.name and BUSINESS.phone, not re-typed strings", () => {
    expect(BUSINESS.name).toBe("Nick's Tire & Auto");
    expect(SPOKEN_BUSINESS_NAME).toBe("Nick's Tire and Auto");
    expect(CALLBACK_NUMBER).toBe(BUSINESS.phone.display);
    expect(CALLBACK_NUMBER).toBe("(216) 862-0005");
  });

  it("the classification is the one the PR states: three sales lanes, one informational", () => {
    expect(SALES).toEqual(["voice_recovery", "followup_cadence", "followup_manual"]);
    expect(isSalesLane("confirmation")).toBe(false);
  });
});

describe("placeVapiOutboundCall · the body every lane sends", () => {
  let body: Body | null = null;

  beforeEach(() => {
    vi.resetModules();
    body = null;
    vi.stubEnv("VAPI_API_KEY", "canary-key");
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "asst_canary");
    vi.stubEnv("VAPI_PHONE_NUMBER_ID", "pn_canary");
    vi.stubGlobal("fetch", async (_url: string | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? "{}")) as Body;
      return new Response(JSON.stringify({ id: "call_ok" }), { status: 201 });
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function dial(lane: OutboundLane, voicemailMessage?: string) {
    const { placeVapiOutboundCall } = await import("./vapi");
    const r = await placeVapiOutboundCall({
      customerNumber: "+12165550142",
      lane,
      customerName: "Pat Doe",
      openerBody: "LANE WORDS",
      systemPrompt: "LANE PROMPT",
      voicemailMessage,
    });
    expect(r).toEqual({ success: true, callId: "call_ok" });
    return body!.assistantOverrides;
  }

  it.each(LANES)("%s · identity FIRST, then the callback number and the recording notice, then the lane's words", async (lane) => {
    const o = await dial(lane);
    expect(o.firstMessage.startsWith(`Hi Pat, this is ${SPOKEN_BUSINESS_NAME} calling.`)).toBe(true);
    expect(o.firstMessage).toContain(CALLBACK_NUMBER);
    expect(o.firstMessage).toContain("This call may be recorded");
    expect(o.firstMessage.endsWith("LANE WORDS")).toBe(true);
  });

  it.each(SALES)(
    "%s (sales) · the opt-out instruction is the very next sentence after the identity",
    async (lane) => {
      const o = await dial(lane);
      const [identity, next] = o.firstMessage.split(/(?<=\.)\s+/);
      expect(identity).toBe(`Hi Pat, this is ${SPOKEN_BUSINESS_NAME} calling.`);
      expect(next).toMatch(/just say "stop calling" at any time/);
    },
  );

  it("confirmation (informational) · no opt-out sentence in the opener — the tool still rides the call", async () => {
    const o = await dial("confirmation");
    expect(o.firstMessage).not.toMatch(/stop calling/);
    expect(o.model.tools.map((t) => (t.function as { name?: string } | undefined)?.name)).toContain(DO_NOT_CALL_TOOL_NAME);
  });

  it.each(LANES)("%s · the do-not-call tool records and ENDS the call, and the instruction is in the prompt", async (lane) => {
    const o = await dial(lane);
    const dnc = o.model.tools.find((t) => (t.function as { name?: string } | undefined)?.name === DO_NOT_CALL_TOOL_NAME) as
      | { messages: Array<{ type: string; content?: string; endCallAfterSpokenEnabled?: boolean }> }
      | undefined;
    expect(dnc, "recordDoNotCall must be offered on every outbound call").toBeDefined();
    // Both outcomes hang up — ending the call never depends on the model.
    expect(dnc!.messages.find((m) => m.type === "request-complete")?.endCallAfterSpokenEnabled).toBe(true);
    expect(dnc!.messages.find((m) => m.type === "request-failed")?.endCallAfterSpokenEnabled).toBe(true);
    // Vapi's request-complete/request-failed transport messages cannot truthfully
    // claim a durable suppression; the webhook result may still be retryable.
    for (const message of dnc!.messages) {
      expect(message.content ?? "").toMatch(/ending the call/i);
      expect(message.content ?? "").not.toMatch(/taken .*off|won't call again|will not call again/i);
    }
    const system = o.model.messages[0]!.content;
    expect(system.startsWith("LANE PROMPT")).toBe(true);
    expect(system).toContain(`call ${DO_NOT_CALL_TOOL_NAME} IMMEDIATELY`);
  });

  it.each(SALES)(
    "%s (sales) · voicemail ends WITHOUT a message, even when a lane passes one",
    async (lane) => {
      const o = await dial(lane, `Hi, this is ${SPOKEN_BUSINESS_NAME}, call ${CALLBACK_NUMBER}`);
      // Explicit "" — omitted would fall back to the live assistant's message.
      expect(o.voicemailMessage).toBe("");
      expect(o.voicemailDetection?.enabled).toBe(true);
      const vm = o.model.tools.find((t) => t.type === "voicemail") as { messages: unknown[] } | undefined;
      expect(vm?.messages).toEqual([]);
    },
  );

  it("the follow-up assistant's OWN definition leaves no voicemail either (what the operator pushes)", async () => {
    const { buildFollowUpAssistantConfig, FOLLOW_UP_FIRST_MESSAGE } = await import("./vapi");
    const def = buildFollowUpAssistantConfig() as { voicemailMessage?: string };
    expect(def.voicemailMessage).toBe("");
    // and its own first message is the compliant opener, templated
    expect(FOLLOW_UP_FIRST_MESSAGE.startsWith(`Hi {{name}}, this is ${SPOKEN_BUSINESS_NAME} calling. If you'd rather we not call`)).toBe(true);
    expect(FOLLOW_UP_FIRST_MESSAGE).toContain(CALLBACK_NUMBER);
  });

  it("POSITIVE CONTROL: the informational lane DOES leave its voicemail, which names the shop and gives the number", async () => {
    const { buildConfirmationVoicemail } = await import("./vapi");
    const vm = buildConfirmationVoicemail({ customerName: "Pat", service: "brake check", preferredDay: "tomorrow" });
    const o = await dial("confirmation", vm);
    expect(o.voicemailMessage).toBe(vm);
    expect(vm.startsWith(`Hi Pat, this is ${SPOKEN_BUSINESS_NAME}`)).toBe(true);
    expect(vm).toContain(CALLBACK_NUMBER);
  });

  it("an informational voicemail that omits the identity or number is REFUSED before any network call", async () => {
    const { placeVapiOutboundCall } = await import("./vapi");
    const r = await placeVapiOutboundCall({
      customerNumber: "+12165550142",
      lane: "confirmation",
      openerBody: "x",
      systemPrompt: "x",
      voicemailMessage: "Hey, call us back!",
    });
    expect(r.success).toBe(false);
    expect(r.errorKind).toBe("config");
    expect(body).toBeNull();
  });
});

describe("every dialling file names its lane, and the lane is the one this PR classified", () => {
  const SERVER = resolve(__dirname, "..");
  const expected: Record<string, OutboundLane> = {
    "cron/jobs/voiceRecovery.ts": "voice_recovery",
    "cron/jobs/followupCadence.ts": "followup_cadence",
    "cron/jobs/confirmationCalls.ts": "confirmation",
    "routers/vapi.ts": "followup_manual",
  };
  it.each(Object.entries(expected))("%s passes lane %s", (file, lane) => {
    const src = readFileSync(resolve(SERVER, file), "utf8");
    const lanes = [...src.matchAll(/placeVapiOutboundCall\(\{[\s\S]*?lane:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(lanes).toEqual([lane]);
  });
});

describe("isSpokenOptOut · the transcript safety net", () => {
  it.each([
    "Please stop calling me.",
    "stop calling",
    "Take me off your list",
    "take me off the call list please",
    "Put me on your do not call list",
    "Don't call me again",
    "never call this number again",
    "Remove my number",
    "I want to opt out",
  ])("catches %j", (u) => expect(isSpokenOptOut(u)).toBe(true));

  it.each([
    "Please stop texting me.",
    "Don't contact me again.",
    "Unsubscribe me.",
    "I want to opt out",
    "Take me off your list",
    "Remove my number",
  ])("classifies broad %j as all-contact", (u) => expect(spokenOptOutScope(u)).toBe("all"));

  it.each([
    "Please stop calling me.",
    "stop calling",
    "take me off the call list please",
    "Put me on your do not call list",
    "Don't call me again",
  ])("classifies call-scoped %j as voice-only", (u) => expect(spokenOptOutScope(u)).toBe("voice"));

  it.each([
    "Stop, stop — who is this?",
    "Can you stop by the shop later?",
    "yeah the brakes are good, thanks",
    "call me back tomorrow",
    "I'll stop in on Saturday",
  ])("does NOT suppress on %j", (u) => expect(isSpokenOptOut(u)).toBe(false));

  it.each([
    "Don't stop calling me.",
    "Never stop calling me.",
    "I do not want you to stop texting me.",
    "Do not opt me out.",
    "Don't unsubscribe me.",
  ])("does NOT invert negated opt-out language: %j", (u) => {
    expect(spokenOptOutScope(u)).toBeNull();
    expect(isSpokenOptOut(u)).toBe(false);
  });

  it.each([
    ["Don't stop calling me, but please stop texting me.", "all"],
    ["Don't stop texting me, but please stop calling me.", "voice"],
    ["Please stop texting me, but don't stop calling me.", "all"],
  ] as const)("keeps evaluating actionable clauses in mixed intent: %j", (u, scope) => {
    expect(spokenOptOutScope(u)).toBe(scope);
    expect(isSpokenOptOut(u)).toBe(true);
  });

  it("reads only the CUSTOMER's lines — the opener itself says \"stop calling\"", () => {
    const opener = `Hi Pat, this is ${SPOKEN_BUSINESS_NAME} calling. If you'd rather we not call, just say "stop calling" at any time.`;
    expect(customerUtterances({ artifact: { messages: [{ role: "bot", message: opener }, { role: "user", message: "yeah good" }] } })).toEqual([
      "yeah good",
    ]);
    expect(customerUtterances({ artifact: { transcript: `AI: ${opener}\nUser: yeah good` } })).toEqual(["yeah good"]);
    expect(customerUtterances({ artifact: { messages: [{ role: "bot", message: opener }] } }).some(isSpokenOptOut)).toBe(false);
  });
});
