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
  requiredForAiFeatures: ["LLM_MODEL"],
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

function checkCodependencies(getEnvVal) {
  const nodeEnv = getEnvVal("NODE_ENV") || "";
  const isProd =
    nodeEnv.trim().toLowerCase() === "production" ||
    process.env.NODE_ENV === "production";

  // Stripe co-dependency check: warns if secret key is present but webhook secret is missing
  const stripeSecret = getEnvVal("STRIPE_SECRET_KEY");
  const stripeWebhook = getEnvVal("STRIPE_WEBHOOK_SECRET");

  if (stripeSecret && stripeSecret.trim() !== "") {
    if (!stripeWebhook || stripeWebhook.trim() === "") {
      console.warn(
        `[env-validate] WARNING: STRIPE_SECRET_KEY is configured but STRIPE_WEBHOOK_SECRET is missing. Stripe API calls may work, but webhook-driven events such as invoice-paid sync, subscription updates, or membership reconciliation may fail.`
      );
    }
  } else if (isProd) {
    console.warn(
      `[env-validate] WARNING: STRIPE_SECRET_KEY is not configured in production mode. Online payments and checkout features will be disabled.`
    );
  }

  if (isProd && (!stripeWebhook || stripeWebhook.trim() === "")) {
    if (!stripeSecret || stripeSecret.trim() === "") {
      console.warn(
        `[env-validate] WARNING: STRIPE_WEBHOOK_SECRET is not configured in production mode. Webhook reconciliation events will be disabled.`
      );
    }
  }

  // D&K co-dependency check: warns if one key is present but not all 3
  const dkUser = getEnvVal("GATEWAY_TIRE_USERNAME");
  const dkPass = getEnvVal("GATEWAY_TIRE_PASSWORD");
  const dkShip = getEnvVal("GATEWAY_TIRE_SHIP_TO");

  if (dkUser || dkPass || dkShip) {
    if (!dkUser || !dkPass || !dkShip) {
      console.warn(
        `[env-validate] WARNING: Some Gateway Tire (D&K) credentials are set, but they are incomplete. Ensure GATEWAY_TIRE_USERNAME, GATEWAY_TIRE_PASSWORD, and GATEWAY_TIRE_SHIP_TO are all set. Graceful mock fallbacks will be used.`
      );
    }
  }
}

function validateTemplate() {
  const filePath = ".env.example";
  if (!fs.existsSync(filePath)) {
    console.error("[env:validate] Missing .env.example");
    process.exit(1);
  }

  const { map: envMap, sectionHits } = parseEnvFile(filePath);
  const missingRequired = allRequiredKeys.filter(key => !envMap.has(key));
  if (!envMap.has("GEMINI_API_KEY") && !envMap.has("OPENAI_API_KEY")) {
    missingRequired.push("GEMINI_API_KEY (or OPENAI_API_KEY)");
  }
  const missingSections = KNOWN_SECTION_HEADERS.filter(
    h => !sectionHits.has(h)
  );

  if (missingRequired.length > 0) {
    console.error("[env:validate] Missing required keys in .env.example:");
    for (const key of missingRequired) console.error(`  - ${key}`);
    process.exit(1);
  }

  // Verify that Stripe and D&K template keys are present in .env.example (even if commented)
  const rawExample = fs.readFileSync(filePath, "utf8");
  const missingOptional = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "GATEWAY_TIRE_USERNAME",
    "GATEWAY_TIRE_PASSWORD",
    "GATEWAY_TIRE_SHIP_TO",
  ].filter(key => !rawExample.includes(key));

  if (missingOptional.length > 0) {
    console.error(
      "[env:validate] Missing optional Stripe or Gateway Tire keys in .env.example:"
    );
    for (const key of missingOptional) console.error(`  - ${key}`);
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

  // Check local .env file if it exists
  const localEnvPath = ".env";
  if (fs.existsSync(localEnvPath)) {
    try {
      const { map: localMap } = parseEnvFile(localEnvPath);
      checkCodependencies(key => localMap.get(key) || process.env[key]);
    } catch (err) {
      console.warn(
        `[env-validate] Failed to parse local .env file: ${err.message}`
      );
    }
  } else {
    // If local .env doesn't exist, check process.env for warnings (e.g. in build pipeline)
    checkCodependencies(key => process.env[key]);
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

  const geminiKey = process.env.GEMINI_API_KEY || "";
  const openaiKey = process.env.OPENAI_API_KEY || "";
  if (geminiKey.trim() === "" && openaiKey.trim() === "") {
    missing.push("GEMINI_API_KEY or OPENAI_API_KEY");
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

  // Check co-dependencies in runtime
  checkCodependencies(key => process.env[key]);

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
