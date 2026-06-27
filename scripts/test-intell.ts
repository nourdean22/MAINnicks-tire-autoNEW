import { runIntelligenceMatching } from "../../apps/statenour/lib/intelligence/intelligence-matching";

async function main() {
  console.log("Running Intelligence Matching...");
  await runIntelligenceMatching();
  console.log("Done.");
}

main().catch(console.error);
