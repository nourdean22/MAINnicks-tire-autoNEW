/**
 * One-off: PATCH the live VAPI assistant with the latest code config.
 *
 * Usage:
 *   npx tsx scripts/vapi-update-assistant.ts
 *
 * Env required: VAPI_API_KEY
 *
 * What it does:
 *   1. Builds the assistant config from server/services/vapi.ts (the
 *      source-of-truth — system prompt, 9 tools, voice, model, analysis).
 *   2. PATCHes /assistant/{id} on api.vapi.ai with that config.
 *   3. Re-fetches the assistant to confirm the update landed.
 *
 * Run this any time the system prompt or tool definitions change in code.
 */

import "dotenv/config";
import { buildAssistantConfig } from "../server/services/vapi";

const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const SERVER_URL = "https://nickstire.org/api/webhooks/vapi";
const VAPI_BASE = "https://api.vapi.ai";

async function main(): Promise<void> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: VAPI_API_KEY not set in environment");
    process.exit(1);
  }

  // 2026-05-06 wave-15.1 · The transferCall destinations are owned by
  // the VAPI dashboard, NOT the code. Before PATCHing, fetch the live
  // assistant and preserve whatever transferCall.destinations are set.
  // This way Nour can change the forward number from the dashboard
  // and code re-pushes won't blow it away.
  console.log(`Fetching current live assistant ${ASSISTANT_ID} to preserve dashboard-managed settings...`);
  const preRes = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!preRes.ok) {
    console.error(`Could not fetch live assistant: ${preRes.status}`);
    process.exit(1);
  }
  const preLive = (await preRes.json()) as Record<string, unknown>;
  const preLiveModel = preLive.model as Record<string, unknown> | undefined;
  const preLiveTools = (preLiveModel?.tools as Array<Record<string, unknown>>) || [];
  const preLiveTransferCall = preLiveTools.find((t) => t.type === "transferCall") as Record<string, unknown> | undefined;
  const liveDestinations = preLiveTransferCall?.destinations as Array<Record<string, unknown>> | undefined;

  const config = buildAssistantConfig(SERVER_URL);

  // Merge: replace code's transferCall destinations with whatever the
  // dashboard has set (preserves Nour's number choice). If dashboard
  // has no transferCall yet (first deploy), code default ships through.
  if (liveDestinations && liveDestinations.length > 0) {
    const codeTransferIdx = config.model.tools.findIndex((t) => t.type === "transferCall");
    if (codeTransferIdx >= 0) {
      const codeTool = config.model.tools[codeTransferIdx];
      if (codeTool.type === "transferCall") {
        codeTool.destinations = liveDestinations.map((d) => {
          // Preserve a dashboard-set transferPlan (e.g. the warm-transfer
          // config) so a code re-push does not silently revert transfers
          // to a blind transfer — which does not connect from a Vapi
          // number. Fall back to the code default's transferPlan.
          const rawPlan =
            (d.transferPlan as { mode: string; message?: string; sipVerb?: string } | undefined) ??
            codeTool.destinations[0]?.transferPlan;
          const transferPlan = rawPlan
            ? { ...rawPlan, sipVerb: "dial" as const }
            : undefined;
          return {
            type: (d.type as "number") || "number",
            number: d.number as string,
            message: (d.message as string) ?? codeTool.destinations[0]?.message,
            description: (d.description as string) ?? codeTool.destinations[0]?.description,
            ...(transferPlan ? { transferPlan } : {}),
          };
        });
        console.log(`✅ Preserved dashboard-set transfer destinations: ${codeTool.destinations.map((d) => d.number).join(", ")}`);
      }
    }
  } else {
    console.log(`⚠️  No live transferCall destinations found — using code default (${config.model.tools.find((t) => t.type === "transferCall" && t.destinations)?.destinations?.[0]?.number ?? "none"})`);
  }

  console.log("");
  console.log("─── Build config summary ───");
  console.log(`  Name:                ${config.name}`);
  console.log(`  Model:               ${config.model.provider} / ${config.model.model}`);
  console.log(`  Voice:               ${config.voice.provider} / ${config.voice.voiceId}`);
  console.log(`  Tool count:          ${config.model.tools.length}`);
  console.log(`  Tool types/names:    ${config.model.tools.map((t) => (t.type === "function" ? t.function.name : t.type)).join(", ")}`);
  const transferTool = config.model.tools.find((t) => t.type === "transferCall");
  if (transferTool && transferTool.type === "transferCall") {
    console.log(`  Transfer to:         ${transferTool.destinations.map((d) => d.number).join(", ")}`);
  }
  console.log(`  Prompt length:       ${config.model.messages[0].content.length} chars`);
  console.log(`  First message:       "${config.firstMessage.slice(0, 90)}..."`);
  console.log(`  Server URL:          ${config.serverUrl}`);
  console.log("");

  // wave-181.50 · inject VAPI_WEBHOOK_SECRET into config.server.secret at
  // PATCH time. VAPI's nested `server` object PATCH replaces the whole
  // object — without injecting the secret, every update would clear it
  // and silently break webhook signatures (the bug we just spent 5 days
  // tracking down). Keep the secret out of static code; pull from env.
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;
  if (webhookSecret && config.server) {
    config.server.secret = webhookSecret;
    console.log(`  Server secret:       <injected from VAPI_WEBHOOK_SECRET, ${webhookSecret.length} chars>`);
  } else if (config.server) {
    console.log(`  ⚠️  Server secret:    <NOT INJECTED — VAPI_WEBHOOK_SECRET env missing>`);
    console.log(`     This will clear the secret on VAPI's side and break webhook signatures.`);
    console.log(`     Aborting to prevent the regression.`);
    process.exit(1);
  }

  console.log(`PATCH https://api.vapi.ai/assistant/${ASSISTANT_ID}`);

  const res = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`\n❌ PATCH failed: ${res.status}`);
    console.error(text.slice(0, 1500));
    process.exit(1);
  }

  console.log(`✅ PATCH succeeded (${res.status})\n`);

  // Verify
  console.log("─── Verifying live state ───");
  const verifyRes = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!verifyRes.ok) {
    console.error(`Verify fetch failed: ${verifyRes.status}`);
    process.exit(1);
  }

  const live = (await verifyRes.json()) as Record<string, unknown>;
  const liveModel = live.model as Record<string, unknown> | undefined;
  const liveTools = (liveModel?.tools as Array<Record<string, unknown>>) || [];

  console.log(`  ID:                  ${live.id}`);
  console.log(`  Name:                ${live.name}`);
  console.log(`  Updated:             ${live.updatedAt}`);
  console.log(`  Live model:          ${liveModel?.provider} / ${liveModel?.model}`);
  console.log(`  Live tool count:     ${liveTools.length}`);
  const liveToolNames = liveTools.map((t) => {
    if (t.type === "function") {
      const fn = t.function as Record<string, unknown>;
      return fn?.name as string;
    }
    return t.type as string;
  });
  console.log(`  Live tool names:     ${liveToolNames.join(", ")}`);
  console.log(`  Live prompt length:  ${(((liveModel?.messages as Array<Record<string, unknown>>) || [])[0]?.content as string)?.length ?? 0} chars`);
  console.log("");

  // Sanity checks
  const checks: Array<{ ok: boolean; name: string; detail: string }> = [
    {
      ok: liveModel?.provider === config.model.provider,
      name: "Model provider matches",
      detail: `${liveModel?.provider} === ${config.model.provider}`,
    },
    {
      ok: liveModel?.model === config.model.model,
      name: "Model name matches",
      detail: `${liveModel?.model} === ${config.model.model}`,
    },
    {
      ok: liveTools.length === config.model.tools.length,
      name: "Tool count matches",
      detail: `${liveTools.length} === ${config.model.tools.length}`,
    },
    {
      ok: liveToolNames.includes("transferCall"),
      name: "transferCall tool present",
      detail: `tools include transferCall: ${liveToolNames.includes("transferCall")}`,
    },
  ];

  console.log("─── Sanity checks ───");
  for (const c of checks) {
    console.log(`  ${c.ok ? "✅" : "❌"} ${c.name} · ${c.detail}`);
  }
  const allPassed = checks.every((c) => c.ok);
  console.log("");
  console.log(allPassed ? "🎉 All checks passed." : "⚠️  Some checks failed — review above.");
  process.exit(allPassed ? 0 : 1);
}

main().catch((err: Error) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
