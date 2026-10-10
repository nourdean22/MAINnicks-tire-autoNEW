/**
 * READ-ONLY · what is ACTUALLY armed in production right now?
 *
 * Why this exists (2026-08-16): `truth_os.md` and `docs/ISSUE-REGISTRY.md` both
 * asserted `FEATURE_DECLINED_RECOVERY=0` "read-back verified" for eight days.
 * Live env returned `=1` and `cron_log` showed six customer texts in three days.
 * A doc asserting a flag value is a CACHE, and this repo has no invalidation for
 * it — so the only honest receipt is a dated read of the service.
 *
 * `scripts/audit-feature-flag-state.ts` already existed and could not have
 * caught it: it reads the `feature_flags` DB table, and every flag below is an
 * ENVIRONMENT VARIABLE. Two flag systems, one auditor, structural blind spot.
 *
 * Read-only by construction: shells out to `railway variables`, never
 * `--set`/`--service ... --set`. Nothing here can mutate the service.
 *
 * Usage: node scripts/probe-live-send-flags.mjs [--service <name>]
 */
import { execSync } from "node:child_process";

const SERVICE =
  process.argv.includes("--service")
    ? process.argv[process.argv.indexOf("--service") + 1]
    : "MAINnicks-tire-auto";

/** Flags whose ON state produces an EXTERNAL side effect — a text, a call, a post. */
const SIDE_EFFECT_FLAGS = {
  FEATURE_DECLINED_RECOVERY: "SMS · 'you declined this work' follow-ups (ROS-093)",
  FEATURE_VOICE_RECOVERY: "VOICE · outbound recovery calls",
  FEATURE_CONFIRMATION_CALLS: "VOICE · outbound appointment confirmation calls",
  FEATURE_FOLLOWUP_CADENCE: "SMS · multi-touch follow-up cadence",
  FEATURE_UNPAID_INVOICE_RECOVERY: "SMS · unpaid-invoice chase",
  ENABLE_CUSTOMER_CONFIRMATIONS: "SMS · booking confirmations to customers",
  REEL_PUBLISH_ENABLED: "PUBLISH · reels to Instagram",
  REEL_AUTOPOST_ENABLED: "PUBLISH · unattended reel posting",
  REEL_COMMENT_RESPONDER_ENABLED: "PUBLISH · public replies to IG comments",
};

/** `=== "1"` and `!== "false"` guards disagree about what an UNSET var means. */
const TRUTHY = new Set(["1", "true", "TRUE", "yes", "on"]);

// The CLI is a railway.cmd shim on Windows, which Node refuses to spawn without
// a shell (EINVAL since the 2024 .cmd-injection hardening). So this goes through
// a shell, and SERVICE is constrained to a service-shaped token first — the one
// value that is not a literal in the command string.
if (!/^[A-Za-z0-9._-]+$/.test(SERVICE)) {
  console.error(`refusing service name with shell metacharacters: ${SERVICE}`);
  process.exit(2);
}

let raw;
try {
  raw = execSync(`railway variables --service ${SERVICE} --kv`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  console.error(
    "FAILED to read Railway env — do NOT fall back to a doc or a .env file.\n" +
      String(err?.stderr || err?.message || err).slice(0, 300),
  );
  process.exit(1);
}

const env = new Map(
  raw
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z][A-Z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const rows = Object.entries(SIDE_EFFECT_FLAGS).map(([key, effect]) => {
  const value = env.get(key);
  return {
    flag: key,
    live: value === undefined ? "(unset)" : value,
    armed: value === undefined ? "unset — read the guard" : TRUTHY.has(value) ? "ARMED" : "off",
    effect,
  };
});

console.log(`service: ${SERVICE}`);
console.log(`read at: ${new Date().toISOString()} (UTC)\n`);
console.table(rows);

const armed = rows.filter((r) => r.armed === "ARMED");
console.log(
  `\n${armed.length}/${rows.length} side-effect flags ARMED: ${armed.map((r) => r.flag).join(", ") || "none"}`,
);
console.log(
  "\nPaste the table above into a doc WITH the timestamp, or do not assert a flag value at all.",
);
