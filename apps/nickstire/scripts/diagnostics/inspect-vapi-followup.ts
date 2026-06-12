/**
 * Pull the full config of the follow-up assistant so we can see exactly
 * what's wired for outbound · including any phoneNumberId or override.
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const apiKey = process.env.VAPI_API_KEY;
const assistantId = process.env.VAPI_FOLLOWUP_ASSISTANT_ID;
if (!apiKey || !assistantId) {
  console.error("VAPI_API_KEY or VAPI_FOLLOWUP_ASSISTANT_ID missing");
  process.exit(1);
}

(async () => {
  const r = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!r.ok) {
    console.error(`Status ${r.status}: ${await r.text()}`);
    process.exit(1);
  }
  const a = await r.json() as Record<string, unknown>;

  // Pretty-print the parts we care about
  console.log("\n═══ Follow-Up Assistant config ═══\n");
  console.log(`id            : ${a.id}`);
  console.log(`name          : ${a.name}`);
  console.log(`voiceMode     : ${(a as any).voiceMode || "(default)"}`);
  console.log(`firstMessage  : ${String(a.firstMessage || "").slice(0, 120)}`);
  console.log(`server.url    : ${((a as any).server?.url) || "(none)"}`);
  console.log(`server.secret : ${((a as any).server?.secret) ? "(set)" : "(not set)"}`);
  console.log(`model         : ${(a as any).model?.provider}/${(a as any).model?.model}`);
  console.log(`voice         : ${(a as any).voice?.provider}/${(a as any).voice?.voiceId}`);
  console.log(`transcriber   : ${(a as any).transcriber?.provider}/${(a as any).transcriber?.model}`);

  // The crucial outbound-related fields
  console.log("\n--- outbound fields ---");
  console.log(`forwardingPhoneNumber : ${(a as any).forwardingPhoneNumber || "(none)"}`);
  console.log(`forwardingPhoneNumbers: ${JSON.stringify((a as any).forwardingPhoneNumbers || []).slice(0, 100)}`);

  // Pull phone numbers + which assistant they're attached to + check for outbound mapping
  const numsR = await fetch("https://api.vapi.ai/phone-number", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const nums = await numsR.json() as Array<Record<string, unknown>>;
  console.log("\n═══ All phone numbers (full config) ═══\n");
  for (const n of nums) {
    console.log(`id            : ${n.id}`);
    console.log(`number        : ${n.number}`);
    console.log(`name          : ${n.name}`);
    console.log(`provider      : ${n.provider}`);
    console.log(`assistantId   : ${n.assistantId || "(no inbound assistant)"}`);
    console.log(`squadId       : ${n.squadId || "(none)"}`);
    console.log(`fallbackDestination: ${JSON.stringify((n as any).fallbackDestination || null).slice(0, 100)}`);
    console.log("---");
  }
})().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
