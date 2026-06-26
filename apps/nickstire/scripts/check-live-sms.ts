import { getDbTyped } from "../server/db";
import { smsMessages, nickgptDrafts, smsConversations } from "../drizzle/schema";
import { desc, eq, or } from "drizzle-orm";
import dotenv from "dotenv";
import path from "path";

async function checkCapevace() {
  const username = process.env.SHOP_SMS_GATEWAY_USERNAME;
  const password = process.env.SHOP_SMS_GATEWAY_PASSWORD;
  const baseUrl = process.env.SHOP_SMS_GATEWAY_URL || "https://api.sms-gate.app/3rdparty/v1";

  if (!username || !password) {
    console.log("Capevace API credentials not configured.");
    return;
  }

  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  try {
    const res = await fetch(`${baseUrl}/device`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.log(`Capevace API returned status: ${res.status}`);
      return;
    }
    const devices = await res.json() as any[];
    console.log("CAPEVACE DEVICES:");
    console.log(JSON.stringify(devices, null, 2));

    // Try GET /messages
    const msgRes2 = await fetch(`${baseUrl}/messages?limit=10`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    });
    console.log(`Capevace GET /messages returned status: ${msgRes2.status}`);
    if (msgRes2.ok) {
      const msgs = await msgRes2.json();
      console.log("CAPEVACE MESSAGES (GET /messages):", JSON.stringify(msgs, null, 2));
    }

    // Try GET /inbox
    const inboxRes1 = await fetch(`${baseUrl}/inbox?limit=10`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    });
    console.log(`Capevace GET /inbox returned status: ${inboxRes1.status}`);
    if (inboxRes1.ok) {
      const inbox = await inboxRes1.json();
      console.log("CAPEVACE INBOX (GET /inbox):", JSON.stringify(inbox, null, 2));
    }

    // Try GET /message/inbox
    const inboxRes2 = await fetch(`${baseUrl}/message/inbox?limit=10`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    });
    console.log(`Capevace GET /message/inbox returned status: ${inboxRes2.status}`);
    if (inboxRes2.ok) {
      const inbox = await inboxRes2.json();
      console.log("CAPEVACE INBOX (GET /message/inbox):", JSON.stringify(inbox, null, 2));
    }
  } catch (err: any) {
    console.log("Failed to query Capevace:", err.message || err);
  }
}

async function main() {
  await checkCapevace();

  const db = await getDbTyped();
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }
  
  try {
    const nourConvs = await db
      .select()
      .from(smsConversations)
      .where(
        or(
          eq(smsConversations.phone, "2163383556"),
          eq(smsConversations.phone, "+12163383556"),
          eq(smsConversations.phone, "12163383556"),
          eq(smsConversations.id, 3720009)
        )
      );
    console.log("NOUR CONVERSATIONS IN DB:");
    console.log(JSON.stringify(nourConvs, null, 2));

    const inboundMessages = await db
      .select({
        id: smsMessages.id,
        conversationId: smsMessages.conversationId,
        direction: smsMessages.direction,
        body: smsMessages.body,
        twilioSid: smsMessages.twilioSid,
        status: smsMessages.status,
        createdAt: smsMessages.createdAt,
      })
      .from(smsMessages)
      .where(eq(smsMessages.conversationId, 3720008))
      .orderBy(desc(smsMessages.id));

    console.log("NOUR CONVERSATION 3720008 MESSAGES:");
    console.log(JSON.stringify(inboundMessages, null, 2));

    const generalMessages = await db
      .select({
        id: smsMessages.id,
        conversationId: smsMessages.conversationId,
        direction: smsMessages.direction,
        body: smsMessages.body,
        twilioSid: smsMessages.twilioSid,
        status: smsMessages.status,
        createdAt: smsMessages.createdAt,
      })
      .from(smsMessages)
      .orderBy(desc(smsMessages.id))
      .limit(10);

    console.log("\nGENERAL LATEST 10 MESSAGES:");
    console.log(JSON.stringify(generalMessages, null, 2));

    const latestInbound = await db
      .select({
        messageId: smsMessages.id,
        conversationId: smsMessages.conversationId,
        body: smsMessages.body,
        twilioSid: smsMessages.twilioSid,
        status: smsMessages.status,
        createdAt: smsMessages.createdAt,
        phone: smsConversations.phone,
      })
      .from(smsMessages)
      .leftJoin(smsConversations, eq(smsMessages.conversationId, smsConversations.id))
      .where(eq(smsMessages.direction, "inbound"))
      .orderBy(desc(smsMessages.id))
      .limit(10);

    console.log("\nLATEST 10 INBOUND MESSAGES:");
    console.log(JSON.stringify(latestInbound, null, 2));

    const drafts = await db
      .select({
        id: nickgptDrafts.id,
        customerPhone: nickgptDrafts.customerPhone,
        inboundMessage: nickgptDrafts.inboundMessage,
        draftReply: nickgptDrafts.draftReply,
        operatorReply: nickgptDrafts.operatorReply,
        intent: nickgptDrafts.intent,
        autoSent: nickgptDrafts.autoSent,
        status: nickgptDrafts.status,
        createdAt: nickgptDrafts.createdAt,
      })
      .from(nickgptDrafts)
      .where(
        or(
          eq(nickgptDrafts.customerPhone, "2163383556"),
          eq(nickgptDrafts.customerPhone, "+12163383556"),
          eq(nickgptDrafts.customerPhone, "12163383556")
        )
      )
      .orderBy(desc(nickgptDrafts.id));

    console.log("\nNOUR DRAFTS:");
    console.log(JSON.stringify(drafts, null, 2));

    const generalDrafts = await db
      .select({
        id: nickgptDrafts.id,
        customerPhone: nickgptDrafts.customerPhone,
        inboundMessage: nickgptDrafts.inboundMessage,
        draftReply: nickgptDrafts.draftReply,
        intent: nickgptDrafts.intent,
        autoSent: nickgptDrafts.autoSent,
        status: nickgptDrafts.status,
        createdAt: nickgptDrafts.createdAt,
      })
      .from(nickgptDrafts)
      .orderBy(desc(nickgptDrafts.id))
      .limit(10);

    console.log("\nGENERAL LATEST 10 DRAFTS:");
    console.log(JSON.stringify(generalDrafts, null, 2));
  } catch (err) {
    console.error("FAILED:", err);
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(console.error);
