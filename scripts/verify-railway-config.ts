import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Define critical environment variables to verify.
//
// The three LIVEKIT_* keys were dropped 2026-08-05 with the voice retirement.
// apps/voice was removed 2026-08-03 and its Railway service was deleted; no
// code in apps/** or packages/** reads LIVEKIT_URL, LIVEKIT_API_KEY, or
// LIVEKIT_API_SECRET, and the key + secret were cleared off statenour-web.
// Leaving them here would make this script report "action needed" forever for
// a product that no longer exists — a checker that cries wolf gets ignored,
// and then it stops catching the keys that DO matter.
//
// CARTESIA_API_KEY is deliberately NOT added: it is genuinely required (the
// morning-brief TTS reads it), but this list is the pre-existing critical set
// and widening it is a separate call.
const REQUIRED_KEYS = [
  "ANTHROPIC_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "RESEND_API_KEY",
  "REDIS_URL",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
];

interface EnvReport {
  key: string;
  localState: "SET" | "MISSING";
  railwayState: "SET" | "MISSING" | "UNKNOWN (No CLI)";
  actionNeeded: string;
}

function checkLocalEnv(): Record<string, string> {
  const localEnv: Record<string, string> = {};
  const paths = [
    path.join(__dirname, "../apps/statenour/.env"),
    path.join(__dirname, "../apps/statenour/.env.local"),
    path.join(__dirname, "../apps/statenour/.env.production"),
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            localEnv[key] = val;
          }
        }
      }
    }
  }
  return localEnv;
}

function checkRailwayEnv(): Record<string, string> | null {
  try {
    // Attempt to run railway variables list command with JSON output
    const output = execSync("railway variables --json", { stdio: ["pipe", "pipe", "ignore"], encoding: "utf-8" });
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function verifyConfig() {
  console.log("=====================================================================");
  console.log("          Nicks Statenour-OS Railway Config Diagnostics              ");
  console.log("=====================================================================\n");

  const local = checkLocalEnv();
  const railway = checkRailwayEnv();

  const reports: EnvReport[] = [];
  const commandsToRun: string[] = [];

  for (const key of REQUIRED_KEYS) {
    const isLocalSet = !!local[key] || !!process.env[key];
    const isRailwaySet = railway ? !!railway[key] : null;

    let railwayStateStr: EnvReport["railwayState"] = "UNKNOWN (No CLI)";
    if (railway !== null) {
      railwayStateStr = isRailwaySet ? "SET" : "MISSING";
    }

    let action = "No action needed.";
    if (!isLocalSet) {
      action = `Define ${key} in apps/statenour/.env.local`;
    } else if (isRailwaySet === false) {
      action = `Sync to Railway production`;
      // Never interpolate the real secret — this output lands in terminals,
      // logs, and screen-shares. The operator pastes the value from .env.local.
      commandsToRun.push(`railway variables:set ${key}="<paste value from apps/statenour/.env.local>"`);
    }

    reports.push({
      key,
      localState: isLocalSet ? "SET" : "MISSING",
      railwayState: railwayStateStr,
      actionNeeded: action,
    });
  }

  // Render report table
  console.table(reports);

  if (commandsToRun.length > 0) {
    console.log("\n=====================================================================");
    console.log("👉 ACTION ITEMS: Run the following commands to sync missing Railway keys:");
    console.log("=====================================================================");
    for (const cmd of commandsToRun) {
      console.log(cmd);
    }
  } else {
    console.log("\n✅ Configuration is fully synced or Railway CLI is offline.");
  }
}

verifyConfig();
