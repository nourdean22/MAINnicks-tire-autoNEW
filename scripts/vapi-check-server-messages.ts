import "dotenv/config";

async function main() {
  const apiKey = process.env.VAPI_API_KEY;

  // Assistant
  const ar = await fetch("https://api.vapi.ai/assistant/150fe622-0b9f-4b03-b8c7-3063812717ae", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const a = await ar.json() as Record<string, unknown>;
  console.log("─── Assistant serverMessages ───");
  console.log("serverMessages:", a.serverMessages);
  console.log("clientMessages:", a.clientMessages);
  console.log("");

  // Phone numbers
  const pr = await fetch("https://api.vapi.ai/phone-number", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const phones = await pr.json() as Array<Record<string, unknown>>;
  console.log("─── Phone numbers ───");
  for (const p of phones) {
    console.log(`Phone: ${p.number || p.twilioPhoneNumber}`);
    console.log(`  assistantId:    ${p.assistantId}`);
    console.log(`  fallbackDest:   ${JSON.stringify(p.fallbackDestination)}`);
    console.log(`  serverUrl:      ${p.serverUrl}`);
    console.log(`  status:         ${p.status}`);
    // Print all keys to find anything weird
    console.log(`  all keys: ${Object.keys(p).join(", ")}`);
  }
}
main().catch(err => { console.error(err); process.exit(1); });
