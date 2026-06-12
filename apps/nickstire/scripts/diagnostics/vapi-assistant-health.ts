import "dotenv/config";

async function main() {
  const r = await fetch("https://api.vapi.ai/assistant/150fe622-0b9f-4b03-b8c7-3063812717ae", {
    headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
  });
  const c = await r.json() as Record<string, unknown>;
  console.log("Status:", r.status);
  console.log("Name:", c.name);
  console.log("Updated:", c.updatedAt);
  console.log("serverUrl:", c.serverUrl);
  console.log("forwardingPhoneNumber:", c.forwardingPhoneNumber);
  const model = c.model as Record<string, unknown> | undefined;
  console.log("Model provider:", model?.provider, "/", model?.model);
  const tools = model?.tools as Array<unknown> | undefined;
  console.log("Tools:", tools?.length);
  const voice = c.voice as Record<string, unknown> | undefined;
  console.log("Voice:", voice?.provider, "/", voice?.voiceId);
  const messages = model?.messages as Array<Record<string, unknown>> | undefined;
  console.log("Has system prompt:", !!messages?.[0]?.content);
  console.log("Prompt length:", typeof messages?.[0]?.content === "string" ? (messages[0].content as string).length : "?");
  console.log("Voicemail detect enabled:", c.voicemailDetectionEnabled);

  // Phone number config
  const pr = await fetch("https://api.vapi.ai/phone-number", {
    headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
  });
  const phones = await pr.json() as Array<Record<string, unknown>>;
  console.log("\n─── Phone numbers ───");
  for (const p of phones) {
    console.log(`  · ${p.number || p.twilioPhoneNumber} → assistantId=${p.assistantId} · status=${p.status} · provider=${p.provider}`);
  }
}
main().catch(err => { console.error(err); process.exit(1); });
