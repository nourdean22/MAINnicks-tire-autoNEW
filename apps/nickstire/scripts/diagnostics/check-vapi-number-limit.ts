/**
 * Pull the FULL VAPI phone number config to see the outbound daily limit
 * that hard-stopped the May 10 batch at 10 calls.
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const apiKey = process.env.VAPI_API_KEY!;

(async () => {
  const r = await fetch("https://api.vapi.ai/phone-number", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const nums = await r.json() as Array<Record<string, unknown>>;
  for (const n of nums) {
    console.log("\n═══ PHONE NUMBER " + n.number + " ═══");
    console.log(JSON.stringify(n, null, 2));
  }
})().catch((err) => { console.error("FAILED:", err); process.exit(1); });
