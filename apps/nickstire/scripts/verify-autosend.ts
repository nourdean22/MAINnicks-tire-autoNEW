import { handleNickGptAutoSend } from "../server/services/nickgpt-autosend";
import { getDbTyped, getOrCreateConversation } from "../server/db";
import { nickgptDrafts } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

// 1. Mock credentials to enable Shop Gateway path
process.env.SHOP_SMS_GATEWAY_USERNAME = "mock-user";
process.env.SHOP_SMS_GATEWAY_PASSWORD = "mock-password";
process.env.SHOP_SMS_GATEWAY_DEVICE_ID = "device-123";

// 2. Mock global.fetch to intercept device check and message send pings
const originalFetch = global.fetch;
global.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof url === "string" ? url : "url" in url ? url.url : (url as any).toString();
  if (urlStr.includes("sms-gate.app") || urlStr.includes("3rdparty/v1")) {
    if (urlStr.endsWith("/device")) {
      return new Response(
        JSON.stringify([
          {
            id: "device-123",
            lastSeen: new Date().toISOString(),
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.endsWith("/message")) {
      return new Response(
        JSON.stringify({
          id: "msg_mock_987654321",
          state: "accepted",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  }
  return originalFetch(url, init);
};

async function main() {
  const db = await getDbTyped();
  if (!db) {
    console.error("Database connection failed");
    process.exit(1);
  }

  const testCases = [
    { text: "What time do you close?", phone: "2168620001", expectAutoSend: true },
    { text: "Where are you located?", phone: "2168620002", expectAutoSend: true },
    { text: "do you do brakes", phone: "2168620003", expectAutoSend: true },
    { text: "do you do tires", phone: "2168620004", expectAutoSend: true },
    { text: "do you do oil changes", phone: "2168620005", expectAutoSend: true },
    { text: "do you do E-Check", phone: "2168620006", expectAutoSend: true },
    { text: "can I come today", phone: "2168620007", expectAutoSend: true },
    { text: "can I drop it off", phone: "2168620008", expectAutoSend: true },
  ];

  for (const tc of testCases) {
    console.log(`\n--------------------------------------------`);
    console.log(`INBOUND SMS: "${tc.text}" from ${tc.phone}`);
    
    const conversation = await getOrCreateConversation(tc.phone);
    const result = await handleNickGptAutoSend(tc.phone, tc.text, conversation.id);
    console.log(`Result Auto-Sent: ${result.autoSent}`);
    if (result.error) {
      console.log(`Error/Skip Reason: ${result.error}`);
    }
    if (result.draft) {
      console.log(`Sent Reply: "${result.draft}"`);
    }

    // Verify database entry
    const dbDrafts = await db.select()
      .from(nickgptDrafts)
      .where(eq(nickgptDrafts.inboundMessage, tc.text))
      .orderBy(desc(nickgptDrafts.id))
      .limit(1);

    if (dbDrafts && dbDrafts.length > 0) {
      const d = dbDrafts[0];
      console.log(`Database verification:`);
      console.log(`  - logged id: ${d.id}`);
      console.log(`  - intent: ${d.intent}`);
      console.log(`  - confidence: ${Math.round((d.confidence || 0) * 100)}%`);
      console.log(`  - autoSent: ${d.autoSent}`);
      console.log(`  - status: ${d.status}`);
    } else {
      console.log(`Database verification: NO row found in nickgpt_drafts!`);
    }
  }
}

main().catch(console.error).finally(() => {
  global.fetch = originalFetch;
});
