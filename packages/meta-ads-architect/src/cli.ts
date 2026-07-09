import fs from "fs";
import path from "path";
import { generateCampaignPlan } from "./generator/index.js";
import { NicksTirePreset } from "./presets/nicks-tire.js";

async function run() {
  const args = process.argv.slice(2);
  
  let preset = args.includes("--preset") ? args[args.indexOf("--preset") + 1] : "none";
  let outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : "./plan.json";

  let input = null;
  if (preset === "nicks-tire") {
    input = NicksTirePreset;
  } else {
    console.error("No valid preset provided. Use --preset nicks-tire");
    process.exit(1);
  }

  console.log(`Generating Meta Ads Campaign Plan using preset: ${preset}...`);
  
  // Running purely deterministic generation for CLI
  const plan = await generateCampaignPlan(input);

  const fullOutPath = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(fullOutPath), { recursive: true });
  
  fs.writeFileSync(fullOutPath, JSON.stringify(plan, null, 2));
  
  console.log(`\n✅ Plan generated successfully! Saved to: ${fullOutPath}`);
}

run().catch(err => {
  console.error("Error generating plan:", err);
  process.exit(1);
});
