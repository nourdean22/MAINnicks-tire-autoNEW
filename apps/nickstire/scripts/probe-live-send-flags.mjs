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
import { pathToFileURL } from "node:url";

const SERVICE =
  process.argv.includes("--service")
    ? process.argv[process.argv.indexOf("--service") + 1]
    : "MAINnicks-tire-auto";

/**
 * Flags whose ON state produces an EXTERNAL side effect: a text, a call, a post.
 * `armedWhen` is the exact value the code compares against (`=== "1"` vs `=== "true"`).
 * A shared truthy set used to call ENABLE_CUSTOMER_CONFIRMATIONS=1 ARMED while
 * sendCustomerMessage needs exactly "true". server/__tests__/probeLiveSendFlags.test.ts
 * pins each value against server/services/sendPause.ts.
 */
export const SIDE_EFFECT_FLAGS = {
  FEATURE_DECLINED_RECOVERY: { armedWhen: "1", effect: "SMS · 'you declined this work' follow-ups (ROS-093)" },
  FEATURE_VOICE_RECOVERY: { armedWhen: "1", effect: "VOICE · outbound recovery calls" },
  FEATURE_CONFIRMATION_CALLS: { armedWhen: "1", effect: "VOICE · outbound appointment confirmation calls" },
  FEATURE_FOLLOWUP_CADENCE: { armedWhen: "1", effect: "VOICE · multi-touch follow-up cadence calls" },
  ENABLE_CUSTOMER_CONFIRMATIONS: { armedWhen: "true", effect: "SMS + EMAIL · tire-order confirmations to customers" },
  WEATHER_SMS_SEND: { armedWhen: "1", effect: "SMS · weather-triggered texts to lapsed customers" },
  MISSED_CALL_RECOVERY_SEND: { armedWhen: "1", effect: "SMS · missed-caller follow-up texts" },
  REEL_PUBLISH_ENABLED: { armedWhen: "true", effect: "PUBLISH · reels to Instagram" },
  REEL_FB_CROSSPOST_ENABLED: { armedWhen: "true", effect: "PUBLISH · nightly reel also to the Facebook Page" },
  REEL_AUTOPOST_ENABLED: { armedWhen: "true", effect: "PUBLISH · unattended reel posting" },
  REEL_COMMENT_RESPONDER_ENABLED: { armedWhen: "true", effect: "PUBLISH · public replies to IG comments" },
};

/** ARMED only at the exact value the code compares against; unset is its own state. */
export function armedState(flag, value) {
  if (value === undefined) return "unset — read the guard";
  return value === SIDE_EFFECT_FLAGS[flag]?.armedWhen ? "ARMED" : "off";
}
// Import-safe: the Railway read runs only when this file is executed, never when a test imports it.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

function main() {
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

  const rows = Object.entries(SIDE_EFFECT_FLAGS).map(([key, { armedWhen, effect }]) => {
    const value = env.get(key);
    return {
      flag: key,
      live: value === undefined ? "(unset)" : value,
      armed: armedState(key, value),
      armedWhen,
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
}
