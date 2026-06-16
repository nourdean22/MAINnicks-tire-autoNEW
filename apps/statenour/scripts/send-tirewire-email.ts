import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { getAccessToken } from "../lib/services/google-oauth";

async function main() {
  console.log("Initiating API credentials request email via Gmail...");
  const token = await getAccessToken("primary");
  console.log("Acquired access token successfully.");

  const to = "developer@tirewire.com";
  const cc = ["nourdean22@gmail.com", "moeseuclid@gmail.com"];
  
  const rawEmail = [
    `To: ${to}`,
    `Cc: ${cc.join(", ")}`,
    "Subject: API Credentials Request - Dunlap & Kyle B2B Integration (Nick's Tire & Auto)",
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    "Hello developer support team,",
    "",
    "I am writing to request API access credentials for our Dunlap & Kyle (D&K Tire) wholesale account to integrate real-time inventory availability and B2B ordering into our shop management system.",
    "",
    "Could you please provision and send us the following credentials for the Tireweb Connections Center API:",
    "1. Access Key",
    "2. Connection ID",
    "",
    "Our account details are as follows:",
    "- Business Name: Nick's Tire & Auto",
    "- Location: Euclid, OH",
    "- Connected Email: moeseuclid@gmail.com",
    "",
    "Additionally, please share any documentation or WSDL links for the Connections Center SOAP service endpoints.",
    "",
    "Thank you,",
    "Nour Dean",
    "Nick's Tire & Auto"
  ].join("\r\n");

  const encodedEmail = Buffer.from(rawEmail, "utf-8").toString("base64url");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw: encodedEmail,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to send email: ${res.status} ${text}`);
  }

  const result = await res.json();
  console.log("Email sent successfully!");
  console.log("Gmail Message Details:", JSON.stringify(result, null, 2));
}

main().catch(console.error);
