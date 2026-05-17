// audit · which env vars are configured
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

const REQUIRED = ["DATABASE_URL", "CRON_SECRET", "NEXTAUTH_SECRET"];
const OPERATIONAL = [
  "COHERE_API_KEY",
  "VENICE_API_KEY",
  "OLLAMA_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "PERPLEXITY_API_KEY",
  "GMAIL_REFRESH_TOKEN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "FIREFLIES_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "VIDEO_DB_API_KEY",
  "VAPID_PUBLIC_KEY",
];

function main() {
  console.log("=== env-config probe ===\n");
  console.log("[required]");
  for (const k of REQUIRED) {
    const v = process.env[k];
    console.log(`  ${v ? "✓" : "✗"} ${k.padEnd(22)} ${v ? "(set, len=" + v.length + ")" : "(MISSING)"}`);
  }
  console.log("\n[operational]");
  for (const k of OPERATIONAL) {
    const v = process.env[k];
    console.log(`  ${v ? "✓" : "·"} ${k.padEnd(22)} ${v ? "(set)" : "(unset)"}`);
  }
}
main();
