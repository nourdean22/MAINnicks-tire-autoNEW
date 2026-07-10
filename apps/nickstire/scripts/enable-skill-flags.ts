
import { getDbTyped } from "../server/db";
import { featureFlags } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDbTyped();
  if (!db) {
    console.error("Database connection failed");
    process.exit(1);
  }

  const flagsToEnable = [
    "skill_ad_creative_enabled",
    "skill_reel_script_enabled",
    "skill_trend_topics_enabled"
  ];

  for (const flag of flagsToEnable) {
    const existing = await db.select().from(featureFlags).where(eq(featureFlags.key, flag)).limit(1);
    if (existing.length > 0) {
      await db.update(featureFlags).set({ value: true }).where(eq(featureFlags.key, flag));
      console.log(`Enabled existing flag: ${flag}`);
    } else {
      await db.insert(featureFlags).values({
        key: flag,
        value: true,
        description: `Auto-enabled for creative skill packs`,
      });
      console.log(`Created and enabled flag: ${flag}`);
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

