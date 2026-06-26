import { getDb } from "../server/db";
import { smsMessages } from "../drizzle/schema";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database connection failed");
    process.exit(1);
  }

  // Get total count of messages
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(smsMessages);
  console.log("Total messages in entire DB:", count);

  // Direction count for entire DB
  const directions = await db
    .select({
      direction: smsMessages.direction,
      count: sql<number>`count(*)`
    })
    .from(smsMessages)
    .groupBy(smsMessages.direction);
  console.log("Entire DB direction counts:", directions);

  // Date range of messages
  const [minMax] = await db
    .select({
      minDate: sql<string>`min(createdAt)`,
      maxDate: sql<string>`max(createdAt)`
    })
    .from(smsMessages);
  console.log("Date range of messages:", minMax);

  // Let's count by direction for messages older than 365 days
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  console.log("Cutoff date (365 days ago):", cutoff);

  const [dateCounts] = await db
    .select({
      beforeCutoffInbound: sql<number>`sum(case when createdAt < ${cutoff} and direction = 'inbound' then 1 else 0 end)`,
      beforeCutoffOutbound: sql<number>`sum(case when createdAt < ${cutoff} and direction = 'outbound' then 1 else 0 end)`,
      afterCutoffInbound: sql<number>`sum(case when createdAt >= ${cutoff} and direction = 'inbound' then 1 else 0 end)`,
      afterCutoffOutbound: sql<number>`sum(case when createdAt >= ${cutoff} and direction = 'outbound' then 1 else 0 end)`,
    })
    .from(smsMessages);
  console.log("Distribution relative to cutoff:", dateCounts);

  process.exit(0);
}

main().catch(console.error);
