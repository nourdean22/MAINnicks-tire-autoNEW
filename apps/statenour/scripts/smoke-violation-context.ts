// v10.0.414 · smoke for the system-prompt violation block.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { getViolationContext } from "@/lib/brain/violation-context";

async function main() {
  console.log("=== violation-context smoke ===\n");
  const t0 = Date.now();
  const block = await getViolationContext();
  console.log(`elapsed: ${Date.now() - t0}ms`);
  console.log("--- block ---");
  console.log(block || "(empty · no violations above 0.30 rate · clean)");
  console.log("\n--- block length ---");
  console.log(block.length, "chars");
  process.exit(0);
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
