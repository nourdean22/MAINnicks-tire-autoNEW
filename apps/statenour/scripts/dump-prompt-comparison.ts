import { Module } from "node:module";
import { loadEnv } from "./_lib/safety";

function neutralizeServerOnly(): void {
  const cjs = Module as any;
  const original = cjs._load;
  cjs._load = (request: string, parent: any, isMain: boolean) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

async function main() {
  neutralizeServerOnly();
  loadEnv();

  const { buildSystemPromptUncached } = await import("../lib/ai/system-prompt");
  const { buildSystemPromptV2 } = await import("../lib/ai/prompt/v2");

  const v1 = await buildSystemPromptUncached("full", "test");
  const v2 = (await buildSystemPromptV2()).prompt;

  const getHeadings = (p: string) => p.split("\n").filter(l => l.startsWith("##") || l.startsWith("#"));

  console.log("=== V1 HEADINGS ===");
  console.log(getHeadings(v1).join("\n"));
  console.log("\n=== V2 HEADINGS ===");
  console.log(getHeadings(v2).join("\n"));
}

main().catch(console.error);
