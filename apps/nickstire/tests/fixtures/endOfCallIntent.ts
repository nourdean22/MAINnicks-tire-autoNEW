/**
 * Anonymised Vapi end-of-call-report payloads (2026-11-07 receptionist audit, section 3).
 * Shape follows a real archived call: role-tagged artifact.messages, tool calls as a
 * "tool_calls" message. The number is a 555 test number; no real caller words.
 */
const base = {
  type: "end-of-call-report",
  endedReason: "customer-ended-call",
  durationSeconds: 95,
  summary: "Caller asked about two used tires 225/65R17 for a 2014 Honda CR-V and how much they cost.",
};

const talk = [
  { role: "system", message: "You are the receptionist." },
  { role: "bot", message: "Nick's Tire and Auto, what can I do for you?" },
  { role: "user", message: "Hi, do you have used tires in 225 65 17?" },
  { role: "bot", message: "Used tires start at the anchor price, mounted and balanced." },
  { role: "user", message: "Okay, how much for two of them on a 2014 Honda CR-V?" },
  { role: "bot", message: "Easier to see it here. We keep most standard sizes." },
  { role: "user", message: "Alright, thanks." },
];

/** Tire intent, the assistant called neither bookSlot nor sendConfirmationSms. */
export function intentNoToolEvent(callId = "call-fixture-intent-no-tool") {
  return {
    ...base,
    call: { id: callId, type: "inboundPhoneCall", customer: { number: "+12165550147" } },
    artifact: {
      transcript: talk.filter((m) => m.role !== "system").map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.message}`).join("\n"),
      messages: [...talk, { role: "tool_calls", toolCalls: [{ id: "tc-1", type: "function", function: { name: "tireInquiry", arguments: "{\"tireSize\":\"225/65R17\"}" } }] }],
    },
  };
}

/** The same call, but the assistant called bookSlot before the goodbye. */
export function intentWithBookSlotEvent(callId = "call-fixture-intent-booked") {
  const e = intentNoToolEvent(callId);
  e.artifact.messages.push({ role: "tool_calls", toolCalls: [{ id: "tc-2", type: "function", function: { name: "bookSlot", arguments: "{\"service\":\"used tires 225/65R17\"}" } }] });
  return e;
}
