/**
 * Discover what VAPI phone numbers + assistants are already registered.
 * Read-only. Surfaces the IDs the operator can paste into Railway.
 *
 * Run: pnpm exec tsx scripts/list-vapi-numbers.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const apiKey = process.env.VAPI_API_KEY;
if (!apiKey) {
  console.error("VAPI_API_KEY not set in .env");
  process.exit(1);
}

const BASE = "https://api.vapi.ai";

async function vapiGet(path: string): Promise<unknown> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!r.ok) {
    throw new Error(`${path} → ${r.status} ${await r.text().catch(() => "")}`);
  }
  return r.json();
}

(async () => {
  console.log("\n═══ VAPI registered phone numbers ═══\n");
  const nums = (await vapiGet("/phone-number")) as Array<{
    id: string;
    number?: string;
    name?: string;
    provider?: string;
    assistantId?: string | null;
  }>;
  if (!Array.isArray(nums) || nums.length === 0) {
    console.log("  (none registered · operator must buy/import a number in VAPI dashboard)");
  } else {
    for (const n of nums) {
      console.log(`  · id: ${n.id}`);
      console.log(`    number: ${n.number || "(no number)"}`);
      console.log(`    name: ${n.name || "(unnamed)"}`);
      console.log(`    provider: ${n.provider || "(unknown)"}`);
      console.log(`    assistantId: ${n.assistantId || "(no assistant attached)"}`);
      console.log("");
    }
  }

  console.log("\n═══ VAPI assistants ═══\n");
  const assistants = (await vapiGet("/assistant")) as Array<{
    id: string;
    name?: string;
    model?: { model?: string };
  }>;
  if (!Array.isArray(assistants) || assistants.length === 0) {
    console.log("  (none registered)");
  } else {
    for (const a of assistants) {
      console.log(`  · id: ${a.id}`);
      console.log(`    name: ${a.name || "(unnamed)"}`);
      console.log(`    model: ${a.model?.model || "(unknown)"}`);
      console.log("");
    }
  }

  console.log("\n═══ Env hint ═══");
  if (Array.isArray(nums) && nums.length === 1) {
    console.log(`\nSingle number registered · paste this into Railway env:\n`);
    console.log(`  VAPI_PHONE_NUMBER_ID=${nums[0].id}\n`);
  } else if (Array.isArray(nums) && nums.length > 1) {
    console.log(`\n${nums.length} numbers registered · pick one for outbound (probably the shop line) and paste:\n`);
    console.log(`  VAPI_PHONE_NUMBER_ID=<one of the IDs above>\n`);
  }
})().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
