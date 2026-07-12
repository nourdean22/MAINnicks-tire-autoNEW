/**
 * Comprehensive VAPI inspection. Operator says they had outbound calls
 * dialing FROM 216-862-0005 through VAPI · the basic inspection script
 * didn't find that config. This script enumerates ALL VAPI resources to
 * surface where that wiring lives.
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const apiKey = process.env.VAPI_API_KEY!;
const BASE = "https://api.vapi.ai";

async function get(path: string): Promise<unknown> {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!r.ok) return { error: r.status, body: (await r.text()).slice(0, 300) };
  return r.json();
}

(async () => {
  console.log("\n═══ ALL phone numbers (full record) ═══\n");
  const nums = await get("/phone-number") as Array<Record<string, unknown>>;
  for (const n of Array.isArray(nums) ? nums : []) {
    console.log(JSON.stringify(n, null, 2));
    console.log("---");
  }

  console.log("\n═══ Squads (if any) ═══\n");
  const squads = await get("/squad");
  console.log(JSON.stringify(squads, null, 2).slice(0, 2000));

  console.log("\n═══ Recent calls (last 20) · look for outbound from 862-0005 ═══\n");
  const calls = await get("/call?limit=20") as Array<Record<string, unknown>>;
  if (Array.isArray(calls)) {
    for (const c of calls) {
      const type = c.type || "(?)";
      const status = c.status || "(?)";
      const phoneNumber = (c.phoneNumber as Record<string, unknown> | undefined);
      const customer = (c.customer as Record<string, unknown> | undefined);
      console.log(`call ${String(c.id).slice(0, 8)} · type:${type} · status:${status}`);
      console.log(`  from (phoneNumber): ${JSON.stringify(phoneNumber)}`);
      console.log(`  to   (customer)   : ${JSON.stringify(customer)}`);
      console.log(`  assistantId       : ${c.assistantId}`);
      console.log(`  startedAt         : ${c.startedAt}`);
      console.log("---");
    }
  }

  console.log("\n═══ ALL assistants (top-level outbound fields) ═══\n");
  const assistants = await get("/assistant") as Array<Record<string, unknown>>;
  for (const a of Array.isArray(assistants) ? assistants : []) {
    console.log(`Assistant: ${a.name} (${a.id})`);
    console.log(`  forwardingPhoneNumber  : ${a.forwardingPhoneNumber || "(none)"}`);
    console.log(`  forwardingPhoneNumbers : ${JSON.stringify((a as { forwardingPhoneNumbers?: unknown }).forwardingPhoneNumbers || [])}`);
    console.log(`  hipaaEnabled           : ${a.hipaaEnabled}`);
    console.log(`  server.url             : ${(a.server as { url?: string } | undefined)?.url}`);
    console.log("---");
  }
})().catch((err) => { console.error("FAILED:", err); process.exit(1); });
