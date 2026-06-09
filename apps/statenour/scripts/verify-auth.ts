/// <reference types="node" />
import { loadEnvConfig } from "@next/env";
import { getGoogleOauthStatus } from "../lib/services/google-oauth";
import { fetchShopHealth } from "../lib/services/bridge";

// Load environment variables (mirrors Next.js env loading)
loadEnvConfig(process.cwd());

async function main() {
  console.log("=== Auth & Bridge Verification ===");

  try {
    const oauthStatus = await getGoogleOauthStatus();
    console.log(`\nGoogle OAuth Status: ${oauthStatus.state.toUpperCase()}`);
    console.log(`Reason: ${oauthStatus.reason}`);
    console.log(`Email: ${oauthStatus.email || 'N/A'}`);
    
    if (oauthStatus.state !== "healthy") {
      console.log("❌ Google OAuth verification failed.");
      process.exitCode = 1;
    } else {
      console.log("✅ Google OAuth verified successfully.");
    }
  } catch (err) {
    console.error("Error checking Google OAuth:", err);
    process.exitCode = 1;
  }

  try {
    const bridgeHealth = await fetchShopHealth();
    console.log(`\nBridge Health Status: ${bridgeHealth ? "CONNECTED" : "DISCONNECTED"}`);
    
    if (!bridgeHealth) {
      console.log("❌ Bridge API verification failed.");
      process.exitCode = 1;
    } else {
      console.log(`✅ Bridge API verified successfully. Raw response: ${JSON.stringify(bridgeHealth)}`);
    }
  } catch (err) {
    console.error("Error checking Bridge Health:", err);
    process.exitCode = 1;
  }
}

main().catch(console.error);
