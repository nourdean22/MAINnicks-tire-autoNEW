/**
 * One-off · surgical PATCH of just the firstMessage on the live VAPI
 * assistant. Use when operator changes the greeting text on the
 * dashboard and wants it preserved against the next deploy.
 *
 * Usage: pnpm tsx scripts/vapi-update-first-message.ts
 */
import "dotenv/config";

const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const VAPI_BASE = "https://api.vapi.ai";
const NEW_FIRST_MESSAGE = "Nick's Tire and Auto, How can I help — used tire for your car, or something else?";

async function main() {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) { console.error("VAPI_API_KEY not set"); process.exit(1); }

  // Surgical PATCH — only firstMessage changes
  const patchRes = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ firstMessage: NEW_FIRST_MESSAGE }),
  });
  if (!patchRes.ok) {
    console.error(`PATCH failed: ${patchRes.status}`);
    console.error(await patchRes.text());
    process.exit(1);
  }
  console.log(`✅ PATCH succeeded (${patchRes.status})`);

  // Verify
  const verifyRes = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const v = await verifyRes.json() as Record<string, unknown>;
  console.log(`✅ Live firstMessage: "${v.firstMessage}"`);
}
main().catch(err => { console.error("Crashed:", err); process.exit(1); });
