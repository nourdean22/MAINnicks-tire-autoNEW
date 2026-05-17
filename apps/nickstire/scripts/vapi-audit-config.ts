/**
 * Audit live VAPI assistant config — flag any URL/setting that points
 * away from nickstire.org (e.g. autonicks.com, statenour, localhost).
 */
import "dotenv/config";

const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const VAPI_BASE = "https://api.vapi.ai";
const EXPECTED_DOMAIN = "nickstire.org";
const RED_FLAGS = ["autonicks.com", "statenour", "localhost", "127.0.0.1", "ngrok", "railway.app"];

async function main() {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) { console.error("VAPI_API_KEY missing"); process.exit(1); }

  const res = await fetch(`${VAPI_BASE}/assistant/${ASSISTANT_ID}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error(`Fetch failed: ${res.status}`);
    process.exit(1);
  }
  const config = await res.json();

  console.log("\n═══ VAPI Live Config Audit ═══\n");
  console.log(`Assistant: ${config.name} (${config.id})`);
  console.log(`Updated:   ${config.updatedAt}\n`);

  // Stringify the whole config and search for URLs
  const json = JSON.stringify(config, null, 2);
  const urls = [...new Set(json.match(/https?:\/\/[^\s"'<>)]+/g) || [])];

  console.log("─── All URLs found in live config ───");
  for (const u of urls) {
    const isExpected = u.includes(EXPECTED_DOMAIN);
    const isRedFlag = RED_FLAGS.some(rf => u.includes(rf));
    const tag = isRedFlag ? "🔴 WRONG" : isExpected ? "✅ ok" : "⚪ external";
    console.log(`  ${tag}  ${u}`);
  }

  console.log("\n─── Critical fields ───");
  console.log(`  serverUrl:        ${config.serverUrl ?? "(none)"}`);
  console.log(`  serverUrlSecret:  ${config.serverUrlSecret ? "(set)" : "(none)"}`);
  console.log(`  voicemailDetect:  ${config.voicemailDetectionEnabled ?? false}`);
  console.log(`  endCallPhrases:   ${config.endCallPhrases?.length ?? 0} configured`);
  console.log(`  forwardingPhone:  ${config.forwardingPhoneNumber ?? "(none — uses transferCall tool)"}`);

  // Tool-level URLs
  const tools = config.model?.tools || [];
  console.log(`\n─── Tools (${tools.length}) ───`);
  for (const t of tools) {
    const tn = t.function?.name || t.type;
    const tu = t.server?.url || t.url || "(server-managed)";
    const isExpected = typeof tu === "string" && tu.includes(EXPECTED_DOMAIN);
    const isRedFlag = typeof tu === "string" && RED_FLAGS.some(rf => tu.includes(rf));
    const tag = isRedFlag ? "🔴" : isExpected ? "✅" : "⚪";
    console.log(`  ${tag}  ${tn.padEnd(30)} url=${tu}`);
  }

  // Phone numbers
  console.log("\n─── Phone numbers ───");
  const phoneRes = await fetch(`${VAPI_BASE}/phone-number`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (phoneRes.ok) {
    const phones = await phoneRes.json();
    for (const p of phones) {
      console.log(`  · ${p.number || p.twilioPhoneNumber || "?"} → assistant=${p.assistantId || "?"} · server=${p.serverUrl || "(uses assistant default)"}`);
    }
  } else {
    console.log("  (couldn't fetch phone numbers)");
  }

  // Knowledge base
  console.log("\n─── Knowledge bases attached ───");
  const kbs = config.model?.knowledgeBaseId ? [config.model.knowledgeBaseId] : (config.model?.knowledgeBaseIds || []);
  console.log(`  ${kbs.length} attached: ${kbs.join(", ") || "(none)"}`);

  console.log("\n✅ Audit complete.");
}
main().catch(err => { console.error(err); process.exit(1); });
