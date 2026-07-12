/**
 * Pull the FULL VAPI call record · all fields · including the outbound
 * caller-ID metadata (phoneNumber, phoneNumberId, customer, type).
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const callId = process.argv[2] || "019e4176";
const apiKey = process.env.VAPI_API_KEY!;

(async () => {
  // 1. Direct call lookup
  console.log(`\n═══ Call ${callId} · full record ═══\n`);
  const r = await fetch(`https://api.vapi.ai/call/${callId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await r.json();
  console.log(JSON.stringify(data, null, 2).slice(0, 5000));

  // 2. Look at the 5 most recent OUTBOUND calls specifically
  console.log("\n\n═══ All recent calls filtered to outbound ═══\n");
  const all = await (await fetch("https://api.vapi.ai/call?limit=50", {
    headers: { Authorization: `Bearer ${apiKey}` },
  })).json() as Array<Record<string, unknown>>;
  const outbound = Array.isArray(all) ? all.filter((c) => c.type === "outboundPhoneCall") : [];
  for (const c of outbound.slice(0, 5)) {
    console.log(`call ${c.id} · started ${c.startedAt}`);
    console.log(`  phoneNumberId    : ${c.phoneNumberId || "(none)"}`);
    console.log(`  phoneNumber.id   : ${(c.phoneNumber as { id?: string })?.id || "(none)"}`);
    console.log(`  phoneNumber.number: ${(c.phoneNumber as { number?: string })?.number || "(none)"}`);
    console.log(`  customer.number  : ${(c.customer as { number?: string })?.number}`);
    console.log(`  ended reason     : ${c.endedReason}`);
    console.log("---");
  }
})().catch((err) => { console.error("FAILED:", err); process.exit(1); });
