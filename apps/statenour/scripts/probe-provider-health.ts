import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import {
  isVeniceQuotaExhausted,
  isOllamaQuotaExhausted,
  getActiveProviderInfo,
  getRecentlyFailedProviders,
  aiChat,
} from "@/lib/ai/provider";

async function main() {
  console.log("=== provider health probe ===");
  console.log("VENICE_API_KEY set:   ", !!process.env.VENICE_API_KEY);
  console.log("OLLAMA_API_KEY set:   ", !!process.env.OLLAMA_API_KEY);
  console.log("OPENAI_API_KEY set:   ", !!process.env.OPENAI_API_KEY);
  console.log("Venice exhausted:     ", isVeniceQuotaExhausted());
  console.log("Ollama exhausted:     ", isOllamaQuotaExhausted());
  console.log("Active provider:      ", getActiveProviderInfo());
  console.log("Recent failures:      ", getRecentlyFailedProviders());

  console.log("\n--- direct test ---");
  const t0 = Date.now();
  const res = await aiChat(
    [
      { role: "system", content: "Reply with exactly the word OK." },
      { role: "user", content: "go" },
    ],
    "fast",
  );
  console.log(`elapsed: ${Date.now() - t0}ms`);
  console.log("provider:", res.provider);
  console.log("model:", res.model);
  console.log("content:", res.content?.slice(0, 200));
  if (res.failures?.length) {
    console.log("failures:", res.failures);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
