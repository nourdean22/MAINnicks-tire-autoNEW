#!/usr/bin/env node
import fs from "node:fs";

const REQUIRED_KEYS = {
  localAndProd: [
    "NODE_ENV",
    "PORT",
    "DATABASE_URL",
    "JWT_SECRET",
    "ADMIN_API_KEY",
    "VITE_GOOGLE_OAUTH_CLIENT_ID",
  ],
  prodOnly: [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "OWNER_OPEN_ID",
  ],
  requiredForAiFeatures: ["VENICE_API_KEY", "OPENAI_API_KEY", "LLM_MODEL"],
};

const PLACEHOLDER_PATTERNS = [
  /^change-this/i,
  /^your-/i,
  /^example/i,
  /\bplaceholder\b/i,
  /^replace-me/i,
];

const KNOWN_SECTION_HEADERS = [
  "Server",
  "Database",
  "Authentication",
  "Google OAuth",
  "Client-side",
  "AI / LLM",
  "Email",
  "Twilio SMS",
  "Telegram Alerts",
  "Meta / Facebook",
  "Google Analytics",
  "Google Services",
  "Google Sheets / Drive",
  "AWS S3 / CloudFront",
  "Stripe",
  "NOUR OS Bridge",
  "Statenour Sync",
  "Gateway Tire Integration",
  "Auto Labor / ShopDriver Integration",
  "Weather Intelligence",
  "YouTube",
  "Cron / Background Jobs",
  "Remote Access",
  "Observability",
  "Railway",
];

const allRequiredKeys = [
  ...REQUIRED_KEYS.localAndProd,
  ...REQUIRED_KEYS.prodOnly,
  ...REQUIRED_KEYS.requiredForAiFeatures,
];

function isPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(value.trim()));
}

function parseEnvFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const map = new Map();
  const sectionHits = new Set();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith("# ───")) {
      for (const header of KNOWN_SECTION_HEADERS) {
        if (line.includes(header)) sectionHits.add(header);
      }
    }

    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    map.set(key, value);
  }

  return { map, sectionHits };
}

function formatList(items) {
  return items.length === 0 ? "none" : items.map(i => `\n  - ${i}`).join("");
}

function validateTemplate() {
  const filePath = ".env.example";
  if (!fs.existsSync(filePath)) {
    console.error("[env:validate] Missing .env.example");
    process.exit(1);
  }

  const { map: envMap, sectionHits } = parseEnvFile(filePath);
  const missingRequired = allRequiredKeys.filter(key => !envMap.has(key));
  const missingSections = KNOWN_SECTION_HEADERS.filter(
    h => !sectionHits.has(h)
  );

  if (missingRequired.length > 0) {
    console.error("[env:validate] Missing required keys in .env.example:");
    for (const key of missingRequired) console.error(`  - ${key}`);
    process.exit(1);
  }

  console.log("[env:validate] .env.example required key check: PASS");
  console.log(`[env:validate] Required key count: ${allRequiredKeys.length}`);
  console.log(
    `[env:validate] Section coverage check: ${missingSections.length === 0 ? "PASS" : "WARN"}`
  );

  if (missingSections.length > 0) {
    console.log(
      `[env:validate] Missing expected section headers:${formatList(missingSections)}`
    );
  }
}

function validateRuntime() {
  const missing = [];
  const placeholders = [];

  for (const key of allRequiredKeys) {
    const value = process.env[key];

    if (!value || value.trim() === "") {
      missing.push(key);
      continue;
    }

    if (isPlaceholder(value)) placeholders.push(key);
  }

  if (missing.length > 0 || placeholders.length > 0) {
    console.error("[env:validate] Runtime environment check: FAIL");
    if (missing.length > 0) {
      console.error("Missing keys:");
      for (const key of missing) console.error(`  - ${key}`);
    }

    if (placeholders.length > 0) {
      console.error("Placeholder values detected:");
      for (const key of placeholders) console.error(`  - ${key}`);
    }

    process.exit(1);
  }

  console.log("[env:validate] Runtime environment check: PASS");
  console.log(
    `[env:validate] Validated required keys: ${allRequiredKeys.length}`
  );
}

const mode = process.argv.includes("--runtime") ? "runtime" : "template";

if (mode === "runtime") {
  validateRuntime();
} else {
  validateTemplate();
}
