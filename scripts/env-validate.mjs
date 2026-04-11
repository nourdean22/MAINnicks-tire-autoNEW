#!/usr/bin/env node
import fs from "node:fs";

const REQUIRED_KEYS = [
  "NODE_ENV",
  "PORT",
  "DATABASE_URL",
  "JWT_SECRET",
  "ADMIN_API_KEY",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "OWNER_OPEN_ID",
  "VITE_GOOGLE_OAUTH_CLIENT_ID",
  "VENICE_API_KEY",
  "OPENAI_API_KEY",
  "LLM_MODEL",
];

const PLACEHOLDER_PATTERNS = [
  /^change-this/i,
  /^your-/i,
  /^example/i,
  /\bplaceholder\b/i,
];

function isPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(value.trim()));
}

function parseEnvFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const map = new Map();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    map.set(key, value);
  }

  return map;
}

function validateTemplate() {
  const filePath = ".env.example";
  if (!fs.existsSync(filePath)) {
    console.error("[env:validate] Missing .env.example");
    process.exit(1);
  }

  const envMap = parseEnvFile(filePath);
  const missing = REQUIRED_KEYS.filter(k => !envMap.has(k));

  if (missing.length > 0) {
    console.error("[env:validate] Missing required keys in .env.example:");
    for (const key of missing) console.error(`  - ${key}`);
    process.exit(1);
  }

  console.log(
    "[env:validate] .env.example contains all required baseline keys."
  );
}

function validateRuntime() {
  const missing = [];
  const placeholders = [];

  for (const key of REQUIRED_KEYS) {
    const value = process.env[key];
    if (!value || value.trim() === "") {
      missing.push(key);
      continue;
    }

    if (isPlaceholder(value)) placeholders.push(key);
  }

  if (missing.length > 0 || placeholders.length > 0) {
    console.error("[env:validate] Runtime environment check failed.");
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

  console.log("[env:validate] Runtime environment check passed.");
}

const mode = process.argv.includes("--runtime") ? "runtime" : "template";

if (mode === "runtime") {
  validateRuntime();
} else {
  validateTemplate();
}
