/**
 * The fields the webhook logs for one Vapi tool call. Never the argument values.
 *
 * WHY. The tool-call line logged `args` whole, so every recap, booking and
 * callback printed the caller's full name, full phone number and the model's
 * free-text summary into the Railway log (2026-09-23). The log only needs to
 * say which tool ran with which arguments, and for which caller: the argument
 * KEYS, the last 4 digits of any phone argument, and the Vapi call id (an
 * opaque Vapi identifier, not customer data). Consumer: dispatchToolCall in
 * routes/webhooks/vapi.ts.
 */

export interface ToolCallLogFields {
  name: string;
  argKeys: string[];
  phoneLast4?: string;
  callId?: string;
}

export function toolCallLogFields(name: string, args: Record<string, unknown>): ToolCallLogFields {
  const fields: ToolCallLogFields = { name, argKeys: Object.keys(args).sort() };
  // The first phone-shaped argument: phone, customerPhone, callbackPhone …
  for (const [key, value] of Object.entries(args)) {
    if (!key.toLowerCase().includes("phone") || typeof value !== "string") continue;
    const digits = value.replace(/\D/g, "");
    fields.phoneLast4 = digits.length >= 4 ? digits.slice(-4) : "????";
    break;
  }
  if (typeof args.callId === "string") fields.callId = args.callId.slice(0, 100);
  return fields;
}
