/**
 * Create the OUTBOUND follow-up assistant in VAPI.
 *
 * Idempotent — checks if an assistant with the follow-up name
 * already exists; if so, PATCHes it instead of creating a duplicate.
 *
 * After running, the assistant ID is logged. Save it as env var
 * VAPI_FOLLOWUP_ASSISTANT_ID on Railway so the tRPC procedure can
 * trigger outbound calls without hardcoding.
 *
 * Usage: pnpm tsx scripts/vapi-create-followup-assistant.ts
 */
import "dotenv/config";

const VAPI_BASE = "https://api.vapi.ai";
const SERVER_URL = "https://nickstire.org/api/webhooks/vapi";
const FOLLOWUP_ASSISTANT_NAME = "Nick's Tire Follow-Up Caller";

async function main() {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) { console.error("VAPI_API_KEY not set"); process.exit(1); }

  // 1. Check if it already exists
  const listRes = await fetch(`${VAPI_BASE}/assistant`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!listRes.ok) {
    console.error(`List failed: ${listRes.status}`);
    process.exit(1);
  }
  const all = await listRes.json() as Array<{ id: string; name: string }>;
  const existing = all.find((a) => a.name === FOLLOWUP_ASSISTANT_NAME);

  if (existing) {
    console.log(`Found existing follow-up assistant: ${existing.id}`);
    console.log(`Updating it...`);
    const { updateFollowUpAssistant } = await import("../../server/services/vapi");
    const result = await updateFollowUpAssistant(existing.id, SERVER_URL);
    if (!result.success) { console.error(`Update failed: ${result.error}`); process.exit(1); }
    console.log(`✅ Updated assistant ${existing.id}`);
    console.log(`\nSet this on Railway:`);
    console.log(`  railway variables --service MAINnicks-tire-auto --set VAPI_FOLLOWUP_ASSISTANT_ID=${existing.id}`);
    return;
  }

  // 2. Create new
  console.log(`No existing follow-up assistant found. Creating...`);
  const { createFollowUpAssistant } = await import("../../server/services/vapi");
  const result = await createFollowUpAssistant(SERVER_URL);
  if (!result.success || !result.assistantId) {
    console.error(`Create failed: ${result.error}`);
    process.exit(1);
  }
  console.log(`✅ Created follow-up assistant: ${result.assistantId}`);
  console.log(`\nSet this on Railway:`);
  console.log(`  railway variables --service MAINnicks-tire-auto --set VAPI_FOLLOWUP_ASSISTANT_ID=${result.assistantId}`);
  console.log(`\nAlso add to local .env so the tRPC procedure can fire calls in dev.`);
}

main().catch((err) => { console.error("Crashed:", err); process.exit(1); });
