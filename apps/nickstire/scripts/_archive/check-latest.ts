import { getDbTyped } from "../server/db";
import { smsMessages, nickgptDrafts } from "../drizzle/schema";
import { desc } from "drizzle-orm";

async function main() {
  const db = await getDbTyped();
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }
  try {
    const messages = await db
      .select({
        id: smsMessages.id,
        conversationId: smsMessages.conversationId,
        direction: smsMessages.direction,
        body: smsMessages.body,
        createdAt: smsMessages.createdAt,
      })
      .from(smsMessages)
      .orderBy(desc(smsMessages.id))
      .limit(10);

    console.log("MESSAGES (Latest 10):");
    console.log(JSON.stringify(messages, null, 2));

    const drafts = await db
      .select({
        id: nickgptDrafts.id,
        customerPhone: nickgptDrafts.customerPhone,
        inboundMessage: nickgptDrafts.inboundMessage,
        draftReply: nickgptDrafts.draftReply,
        operatorReply: nickgptDrafts.operatorReply,
        intent: nickgptDrafts.intent,
        confidence: nickgptDrafts.confidence,
        autoSent: nickgptDrafts.autoSent,
        status: nickgptDrafts.status,
        createdAt: nickgptDrafts.createdAt,
      })
      .from(nickgptDrafts)
      .orderBy(desc(nickgptDrafts.id))
      .limit(10);

    console.log("\nDRAFTS (Latest 10):");
    console.log(JSON.stringify(drafts, null, 2));
  } catch (err) {
    console.error("FAILED:", err);
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(console.error);
