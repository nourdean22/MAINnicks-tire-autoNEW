/**
 * One-off · wave-92 step B — surgically replace the live transferCall
 * pre-transfer message on the production VAPI assistant. Preserves the
 * current number + description fields; ONLY changes the message string.
 *
 * Why a separate script: scripts/vapi-update-assistant.ts preserves the
 * live destination wholesale (number + message + description) to honor
 * the dashboard-as-truth policy. That's correct for routine deploys —
 * but here we explicitly want to migrate the LIVE message away from
 * the tire-context-leaking phrasing. After this one-off runs once, the
 * deploy script's preserve logic protects the new message going forward.
 *
 * Usage: pnpm tsx scripts/vapi-update-transfer-message.ts
 */
import "dotenv/config";

const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const VAPI_BASE = "https://api.vapi.ai";
const NEW_MESSAGE = "Hold on, I'll get you over to the manager.";

async function main() {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    console.error("VAPI_API_KEY not set");
    process.exit(1);
  }

  // 1. Fetch full live assistant
  const liveRes = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!liveRes.ok) {
    console.error(`Fetch failed: ${liveRes.status}`);
    process.exit(1);
  }
  const live = (await liveRes.json()) as { model?: { tools?: Array<Record<string, unknown>> } };
  const tools = (live.model?.tools || []).slice();
  const idx = tools.findIndex((t) => t.type === "transferCall");
  if (idx < 0) {
    console.error("Live assistant has no transferCall tool");
    process.exit(1);
  }

  // 2. Mutate ONLY the message field on destinations[0]
  const transferTool = tools[idx];
  const destinations = (transferTool.destinations as Array<Record<string, unknown>>) || [];
  if (destinations.length === 0) {
    console.error("transferCall has no destinations to update");
    process.exit(1);
  }
  const oldMessage = destinations[0].message as string | undefined;
  console.log(`Old message: "${oldMessage}"`);
  console.log(`New message: "${NEW_MESSAGE}"`);
  console.log(`Preserving number: ${destinations[0].number}`);
  console.log(`Preserving description: ${(destinations[0].description as string)?.slice(0, 80) ?? "(none)"}...`);

  destinations[0] = {
    ...destinations[0],
    message: NEW_MESSAGE,
  };
  tools[idx] = { ...transferTool, destinations };

  // 3. Surgical PATCH — only model.tools changes
  const patchBody = {
    model: { ...(live.model || {}), tools },
  };
  const patchRes = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patchBody),
  });
  if (!patchRes.ok) {
    console.error(`PATCH failed: ${patchRes.status}`);
    console.error(await patchRes.text());
    process.exit(1);
  }
  console.log(`✅ PATCH succeeded (${patchRes.status})`);

  // 4. Verify
  const verifyRes = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const verified = (await verifyRes.json()) as { model?: { tools?: Array<Record<string, unknown>> } };
  const verifiedTransfer = (verified.model?.tools || []).find((t) => t.type === "transferCall") as Record<string, unknown> | undefined;
  const verifiedDest = (verifiedTransfer?.destinations as Array<Record<string, unknown>> | undefined)?.[0];
  console.log(`✅ Live message now: "${verifiedDest?.message}"`);
  console.log(`✅ Live number still: ${verifiedDest?.number}`);
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});
