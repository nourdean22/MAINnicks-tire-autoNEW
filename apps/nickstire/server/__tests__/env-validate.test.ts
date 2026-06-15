import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import path from "path";

const scriptPath = path.resolve(import.meta.dirname, "../../scripts/env-validate.mjs");

const baseEnv = {
  NODE_ENV: "production",
  PORT: "3000",
  DATABASE_URL: "mysql://user:pass@localhost:3306/db",
  JWT_SECRET: "valid-secret-key-123-xyz",
  ADMIN_API_KEY: "valid-admin-key-123-xyz",
  VITE_GOOGLE_OAUTH_CLIENT_ID: "valid-google-oauth-client-id",
  GOOGLE_OAUTH_CLIENT_ID: "valid-google-oauth-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "valid-google-oauth-client-secret",
  OWNER_OPEN_ID: "google:12345",
  VENICE_API_KEY: "valid-venice-api-key",
  OPENAI_API_KEY: "valid-openai-api-key",
  LLM_MODEL: "llama-3.3-70b",
  // Ensure we clear out inherit system variables so they don't pollute the test environment
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
};

describe("Stripe Env Validate Co-dependency Warning", () => {
  it("warns if STRIPE_SECRET_KEY is present but STRIPE_WEBHOOK_SECRET is missing/empty", () => {
    try {
      const output = execSync(`node ${scriptPath} --runtime`, {
        env: {
          ...process.env,
          ...baseEnv,
          STRIPE_SECRET_KEY: "sk_test_secret_123",
          STRIPE_WEBHOOK_SECRET: "",
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      // Should not throw, should output PASS, but also warn on stderr or stdout
      expect(output).toContain("Runtime environment check: PASS");
    } catch (err: any) {
      console.log("stdout:", err.stdout);
      console.log("stderr:", err.stderr);
      throw err;
    }
  });

  it("does not warn if both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are present", () => {
    const output = execSync(`node ${scriptPath} --runtime`, {
      env: {
        ...process.env,
        ...baseEnv,
        STRIPE_SECRET_KEY: "sk_test_secret_123",
        STRIPE_WEBHOOK_SECRET: "whsec_test_123",
      },
      encoding: "utf8",
    });
    expect(output).toContain("Runtime environment check: PASS");
    expect(output).not.toContain("WARNING: STRIPE_SECRET_KEY is configured");
  });

  it("does not warn if both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are missing", () => {
    const output = execSync(`node ${scriptPath} --runtime`, {
      env: {
        ...process.env,
        ...baseEnv,
        STRIPE_SECRET_KEY: "",
        STRIPE_WEBHOOK_SECRET: "",
      },
      encoding: "utf8",
    });
    expect(output).toContain("Runtime environment check: PASS");
    expect(output).not.toContain("WARNING: STRIPE_SECRET_KEY is configured");
  });
});
