/**
 * Phase 5.2 · Inject Voss negotiation tactics into the VAPI assistant.
 *
 * Fetches the current VAPI assistant, appends a NEGOTIATION TACTICS
 * section to the system prompt (using renderVossPromptSection from
 * lib/nickstire/negotiation-patterns.ts), and PATCHes the assistant
 * via VAPI's REST API.
 *
 * Run: pnpm tsx scripts/update-vapi-negotiation.ts
 * Needs: VAPI_API_KEY env var
 *
 * Safety: dry-run by default. Pass --apply to actually patch.
 */

const VAPI_API_KEY = (process.env.VAPI_API_KEY ?? "").trim();
const VAPI_BASE = "https://api.vapi.ai";
const APPLY = process.argv.includes("--apply");

if (!VAPI_API_KEY) {
  console.error("[!] VAPI_API_KEY not set. Aborting.");
  process.exit(1);
}

async function vapiRequest(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`VAPI ${path} → ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

async function main() {
  console.log("\n📞 VAPI negotiation tactics injection\n");

  // 1. List assistants and find the Nick's Tire one
  const assistants = (await vapiRequest("/assistant")) as Array<{
    id: string;
    name?: string | null;
  }>;

  if (!Array.isArray(assistants) || assistants.length === 0) {
    console.error("[!] No assistants found. Check VAPI_API_KEY.");
    process.exit(1);
  }

  console.log(`Found ${assistants.length} assistant(s):`);
  for (const a of assistants) {
    console.log(`  · ${a.name ?? "(unnamed)"} · id=${a.id}`);
  }

  // Pick the first assistant (typically only one for Nick's Tire)
  const target = assistants[0];
  console.log(`\nTargeting: ${target.name ?? "(unnamed)"} · id=${target.id}\n`);

  // 2. Fetch the full assistant config
  const full = (await vapiRequest(`/assistant/${target.id}`)) as {
    id: string;
    model?: { systemPrompt?: string; messages?: Array<{ role: string; content: string }> };
  };

  // 3. Render the Voss negotiation section
  const { renderVossPromptSection } = await import("../lib/nickstire/negotiation-patterns");
  const negotiationBlock = renderVossPromptSection();

  // 4. Determine where to inject the negotiation tactics
  // VAPI uses either model.systemPrompt (string) or model.messages (array)
  const systemPrompt = full.model?.systemPrompt ?? "";
  const messages = full.model?.messages ?? [];

  // Check if already injected
  if (systemPrompt.includes("NEGOTIATION TACTICS") ||
      messages.some((m) => m.content.includes("NEGOTIATION TACTICS"))) {
    console.log("[!] Negotiation tactics already present in the assistant prompt. Skipping.");
    return;
  }

  // 5. Build the patched config
  let patched: Record<string, unknown>;

  if (systemPrompt) {
    // Append to existing system prompt
    const updatedPrompt = `${systemPrompt}\n\n${negotiationBlock}`;
    patched = {
      model: { ...full.model, systemPrompt: updatedPrompt },
    };
    console.log(`Current system prompt length: ${systemPrompt.length} chars`);
    console.log(`Updated system prompt length: ${updatedPrompt.length} chars`);
  } else if (messages.length > 0) {
    // Append as a new system message
    const updatedMessages = [
      ...messages,
      { role: "system", content: negotiationBlock },
    ];
    patched = {
      model: { ...full.model, messages: updatedMessages },
    };
    console.log(`Current messages: ${messages.length}`);
    console.log(`Updated messages: ${updatedMessages.length}`);
  } else {
    // No existing prompt — set as system prompt
    patched = {
      model: { ...full.model, systemPrompt: negotiationBlock },
    };
    console.log("No existing system prompt found. Setting negotiation block as system prompt.");
  }

  // 6. Show a preview
  console.log("\n── Negotiation block preview ──");
  console.log(negotiationBlock.slice(0, 500) + "...\n");

  if (!APPLY) {
    console.log("[DRY RUN] No changes applied. Pass --apply to patch the assistant.");
    return;
  }

  // 7. PATCH the assistant
  console.log("[APPLY] Patching VAPI assistant...");
  const result = await vapiRequest(`/assistant/${target.id}`, {
    method: "PATCH",
    body: JSON.stringify(patched),
  });
  console.log("[APPLY] Done. Assistant updated.");
  console.log(`\nNegotiation tactics are now live on ${target.name ?? target.id}.`);
}

main().catch((err) => {
  console.error("[!] Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
