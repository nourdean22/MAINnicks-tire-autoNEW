/**
 * Sync our VAPI_WEBHOOK_SECRET (from .env) → the VAPI assistant's
 * `serverUrlSecret` field. The secret never prints to stdout or any
 * log line; only "present"/"absent" booleans surface, plus the PATCH
 * response status.
 *
 * Why this exists: monorepo cutover (May 13, CP1-CP2) didn't carry
 * the assistant's `serverUrlSecret` field across. Result: VAPI signed
 * webhooks with no secret, our verifyVapiSignature() rejected every
 * call with 401, and 5 days of voice-captured leads silently vanished.
 *
 * Run from repo root so dotenv picks up the root .env:
 *   DOTENV_CONFIG_PATH=.env node \
 *     node_modules/.pnpm/tsx@4.22.1/node_modules/tsx/dist/cli.mjs \
 *     apps/nickstire/scripts/vapi-sync-webhook-secret.ts
 */
import "dotenv/config";

const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const VAPI_BASE = "https://api.vapi.ai";

async function main(): Promise<void> {
  const apiKey = process.env.VAPI_API_KEY;
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;

  console.log("═══ VAPI · sync serverUrlSecret ═══\n");
  console.log("Env presence check:");
  console.log("  VAPI_API_KEY:        ", apiKey ? `set (${apiKey.length} chars)` : "MISSING");
  console.log("  VAPI_WEBHOOK_SECRET: ", webhookSecret ? `set (${webhookSecret.length} chars)` : "MISSING");
  if (!apiKey) { console.error("\nERROR: VAPI_API_KEY not in .env"); process.exit(1); }
  if (!webhookSecret) {
    console.error("\nERROR: VAPI_WEBHOOK_SECRET not in .env locally.");
    console.error("  Either add it to .env (matching the value on Railway), OR generate");
    console.error("  a new one and set the SAME value on both sides. Without a matching");
    console.error("  secret on Railway + VAPI, every webhook 401s.");
    process.exit(1);
  }

  // Read live state to confirm what we're overwriting
  console.log("\nFetching live assistant config...");
  const liveRes = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!liveRes.ok) { console.error(`Fetch failed: ${liveRes.status} ${await liveRes.text()}`); process.exit(1); }
  const live = (await liveRes.json()) as Record<string, unknown>;
  const liveSecret = live.serverUrlSecret as string | undefined;
  console.log("  Live serverUrlSecret:", liveSecret ? `present (${liveSecret.length} chars)` : "(none)");

  if (liveSecret === webhookSecret) {
    console.log("\n✅ Already in sync. Nothing to do.");
    process.exit(0);
  }

  // PATCH: write the secret. The PATCH body is JSON; the secret value
  // travels over TLS to api.vapi.ai and is never echoed back into stdout.
  console.log("\nPATCHing VAPI with the .env secret...");
  const patchRes = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ serverUrlSecret: webhookSecret }),
  });
  if (!patchRes.ok) {
    console.error(`PATCH failed: ${patchRes.status} ${await patchRes.text()}`);
    process.exit(1);
  }
  console.log("✅ PATCH succeeded (200)");

  // Verify
  const verifyRes = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const after = (await verifyRes.json()) as Record<string, unknown>;
  const afterSecret = after.serverUrlSecret as string | undefined;
  const matchesEnv = afterSecret === webhookSecret;
  console.log("\nPost-PATCH verify:");
  console.log("  Live serverUrlSecret:", afterSecret ? `present (${afterSecret.length} chars)` : "(none)");
  console.log("  Matches local .env: ", matchesEnv ? "✅ YES" : "❌ NO");

  if (!matchesEnv) {
    console.error("\nWARNING: live secret doesn't match .env even after PATCH. Investigate.");
    process.exit(1);
  }
  console.log("\n🎉 Done. Next VAPI call should land in the DB. Run vapi-today-report.ts after a real call to confirm.");
}
main().catch((e) => { console.error("Crashed:", e); process.exit(1); });
