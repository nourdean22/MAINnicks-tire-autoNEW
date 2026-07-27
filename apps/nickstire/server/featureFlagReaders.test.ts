/**
 * A feature flag that appears nowhere but its own definition is a switch wired
 * to nothing.
 *
 * WHAT WAS FOUND
 * `email_marketing_campaigns` is seeded, rendered in the admin Feature Flags
 * panel, and toggleable. `emailCampaigns.ts` line 4 declares
 * `Feature flag: email_marketing_campaigns (start DISABLED)`. The key appeared
 * in exactly three places repo-wide: the FLAG_DEFINITIONS entry, that
 * doc-comment, and an audit note. There was NO isEnabled() call.
 *
 * So the job sent live marketing email to customers — up to 15 per run via
 * Resend — with no kill switch, while the operator's panel showed a toggle that
 * did nothing. The sibling `gbp-auto-post`, registered a few lines above it in
 * the same scheduler tier, gates correctly at gbpAutoPost.ts:106 — which is
 * what proves the intent rather than assuming it.
 *
 * Not a new class here. featureFlags.ts itself records that "the 19 engine_*
 * control flags were removed (admin-excellence wave) — they were DECORATIVE, no
 * code ever called isEnabled() for them". The same rot grew back.
 *
 * THE DEFINITION THIS TEST USES, AND WHY IT IS NARROW
 * A flag counts as ORPHANED only when its key appears nowhere outside
 * featureFlags.ts. That is deliberately stricter than "has no literal
 * isEnabled(key)" — 13 flags fail the looser test but are named in tables the
 * code iterates (retention tiers pass `tier.flags` to `isEnabled(flag)`) or are
 * consumed client-side. Flagging those would be a false positive, and a test
 * that cries wolf gets deleted.
 *
 * Measured at the time of writing: 46 flags, 16 without a literal reader, of
 * which exactly 3 are true orphans.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FLAG_DEFINITIONS } from "./services/featureFlags";

const ROOT = join(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "..");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) sourceFiles(p, acc);
    else if (/\.(ts|tsx|mts|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p);
  }
  return acc;
}

/** Everything EXCEPT the definitions file itself. */
const SRC = [...sourceFiles(join(ROOT, "server")), ...sourceFiles(join(ROOT, "client", "src"))]
  .filter((p) => !p.replace(/\\/g, "/").endsWith("server/services/featureFlags.ts"))
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");

const hasLiteralReader = (key: string) =>
  new RegExp("isEnabled\\s*\\(\\s*[\"'`]" + key + "[\"'`]").test(SRC);

const ORPHANS = FLAG_DEFINITIONS
  .map((f) => f.key)
  .filter((k) => !hasLiteralReader(k) && !SRC.includes(k));

/**
 * Orphans that are accepted for now. Each MUST carry a reason, and the list may
 * only SHRINK. Adding an entry means shipping a switch the operator can flip
 * that changes nothing — which is what this file exists to prevent.
 *
 * All three are OPERATOR-FACING with no customer effect, which is why they were
 * documented rather than wired: gating a Telegram alert is a different decision
 * from gating an outbound send, and it belongs to whoever owns the alert volume.
 */
const KNOWN_ORPHANS: Record<string, string> = {
  auto_review_responses:
    "Drafts review replies for operator review — never auto-publishes. reviewMonitor.ts imports no feature flags at all, so wiring it is a design choice about whether drafting should be gated, not a missing call.",
  churn_prediction_alerts:
    "Telegram alert to the operator only; no customer effect. runIntelligenceAutopilot sends unconditionally.",
  pricing_intelligence_alerts:
    "Telegram alert to the operator only; no customer effect. runPricingIntelligenceJob sends unconditionally.",
};

describe("feature flags are wired to something", () => {
  it("FLAG_DEFINITIONS is substantial (a shrunken list would pass vacuously)", () => {
    expect(FLAG_DEFINITIONS.length).toBeGreaterThan(30);
  });

  it("the scan actually sees source (an empty SRC would pass everything)", () => {
    expect(SRC.length).toBeGreaterThan(100_000);
    expect(SRC).toMatch(/isEnabled\(/);
  });

  it("no flag is orphaned except the documented ones", () => {
    const undocumented = ORPHANS.filter((k) => !(k in KNOWN_ORPHANS));
    expect(
      undocumented,
      `flag(s) that appear NOWHERE outside featureFlags.ts:\n  ${undocumented.join("\n  ")}\n` +
      `A toggle the operator can flip that changes nothing is worse than no toggle — ` +
      `it is a kill switch they will reach for in an incident.`,
    ).toEqual([]);
  });

  it("the allowlist has no stale entries — it may only SHRINK", () => {
    const stale = Object.keys(KNOWN_ORPHANS).filter((k) => !ORPHANS.includes(k));
    expect(stale, `these are no longer orphaned; remove from KNOWN_ORPHANS: ${stale.join(", ")}`).toEqual([]);
  });

  it("every documented orphan carries a real reason", () => {
    for (const [k, why] of Object.entries(KNOWN_ORPHANS)) {
      expect(why.length, `${k} needs a real reason`).toBeGreaterThan(40);
    }
  });
});

describe("the customer-facing one is fixed, not documented", () => {
  it("email_marketing_campaigns is now READ — it sends live customer email", () => {
    expect(hasLiteralReader("email_marketing_campaigns")).toBe(true);
    expect(KNOWN_ORPHANS).not.toHaveProperty("email_marketing_campaigns");
  });

  it("the gate is in the sender itself, before any recipient query", () => {
    const s = readFileSync(join(ROOT, "server", "services", "emailCampaigns.ts"), "utf8");
    const gate = s.indexOf("email_marketing_campaigns feature flag is disabled");
    const query = s.indexOf("FROM customers c");
    expect(gate).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(-1);
    expect(gate, "the flag must be checked BEFORE selecting recipients").toBeLessThan(query);
  });

  it("the control still holds — gbp_auto_posting was always gated", () => {
    expect(hasLiteralReader("gbp_auto_posting")).toBe(true);
  });
});
