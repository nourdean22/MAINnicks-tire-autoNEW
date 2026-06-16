import dotenv from "dotenv";
import { resolve } from "path";
import { findCtrOpportunities } from "../server/pipelines/gsc-data";

// Load environment variables from monorepo root
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

async function main() {
  console.log("Fetching CTR opportunities from database...");
  const opportunities = await findCtrOpportunities({
    startDate: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), // last 30 days
    minImpressions: 20,
    limit: 15,
  });

  if (opportunities.length === 0) {
    console.log("No CTR opportunities found in the database. Verify if GSC performance data is populated.");
    return;
  }

  console.log(`\n=== CTR Opportunities (Found ${opportunities.length}) ===\n`);
  for (const opp of opportunities) {
    console.log(`Query: "${opp.query}"`);
    console.log(`Page: ${opp.page}`);
    console.log(`Impressions: ${opp.impressions}`);
    console.log(`Current CTR: ${opp.currentCtr}%`);
    console.log(`Average Position: ${opp.avgPosition}`);
    console.log(`Suggested Action: ${opp.suggestedAction}`);
    console.log("--------------------------------------------------\n");
  }
}

main().catch((e) => {
  console.error("Error running script:", e);
  process.exit(1);
});
