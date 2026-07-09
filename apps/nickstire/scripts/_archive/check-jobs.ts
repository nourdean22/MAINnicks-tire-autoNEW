import { getDbTyped } from "../server/db";
import { reelJobs } from "../drizzle/schema";

async function main() {
  const d = await getDbTyped();
  if (!d) return;
  const jobs = await d.select().from(reelJobs);
  console.log("JOBS:");
  for (const j of jobs) {
    console.log(`- ID: ${j.id}, Status: ${j.status}, Attempts: ${j.attempts}`);
  }
}

main().catch(console.error).finally(() => process.exit(0));
