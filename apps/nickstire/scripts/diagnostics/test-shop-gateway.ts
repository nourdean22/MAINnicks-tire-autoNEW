import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const baseUrl = process.env.SHOP_SMS_GATEWAY_URL || "https://api.sms-gate.app/3rdparty/v1";
const username = process.env.SHOP_SMS_GATEWAY_USERNAME!;
const password = process.env.SHOP_SMS_GATEWAY_PASSWORD!;
const auth = Buffer.from(`${username}:${password}`).toString("base64");

// Probe the device endpoint first to verify auth works
console.log(`Probing ${baseUrl}/device with creds...`);
const probe = await fetch(`${baseUrl}/device`, {
  headers: { Authorization: `Basic ${auth}` },
  signal: AbortSignal.timeout(10_000),
});
const probeBody = await probe.text();
console.log(`Probe status: ${probe.status}`);
console.log(`Probe body: ${probeBody.slice(0, 500)}`);
