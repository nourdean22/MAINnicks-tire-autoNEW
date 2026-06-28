import crypto from "crypto";

const WEBHOOK_SECRET = "fac7dd6d32cb8f35fce695bfacdb69a6";
const TARGET_URL = "https://nickstire.org/api/webhooks/sms-gateway";
const CUSTOMER_PHONE = "+12163383556"; // Nour's phone number

const testCases = [
  { text: "What tire pricing do you have?", id: "sim_tire_" + Date.now() },
  { text: "Can I get my brakes done?", id: "sim_brake_" + Date.now() },
  { text: "Do you guys do E-Check?", id: "sim_echeck_" + Date.now() },
  { text: "Can I drop my car off tomorrow?", id: "sim_dropoff_" + Date.now() }
];

async function sendWebhook(bodyText: string, messageId: string) {
  const payload = {
    deviceId: "f_U1jrQBy_g8W-2pWz7g4",
    event: "sms:received",
    id: messageId,
    webhookId: "wh_sim_" + messageId,
    payload: {
      messageId: messageId,
      phoneNumber: CUSTOMER_PHONE,
      message: bodyText,
      receivedAt: new Date().toISOString()
    }
  };

  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  
  // HMAC-SHA256(secret, rawBody + timestamp)
  const message = rawBody + timestamp;
  const signature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(message)
    .digest("hex");

  console.log(`Sending webhook for: "${bodyText}"`);
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Signature: sha256=${signature}`);

  try {
    const res = await fetch(TARGET_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": `sha256=${signature}`,
        "X-Timestamp": timestamp
      },
      body: rawBody
    });

    console.log(`Response Status: ${res.status}`);
    const data = await res.json();
    console.log(`Response Body:`, JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error("Request failed:", err.message || err);
  }
}

async function main() {
  for (const tc of testCases) {
    await sendWebhook(tc.text, tc.id);
    console.log("Waiting 2 seconds between sends...\n");
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

main().catch(console.error);