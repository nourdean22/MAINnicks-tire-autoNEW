/**
 * probe-higgsfield-session-health.mts · READ-ONLY (2026-08-03)
 *
 * Prints what higgsfieldSessionHealth() sees in prod. Pure SELECT against
 * cron_log — no writes, no CLI spawn, no credit spend, no publish. Reading
 * cron_log is the sanctioned way to check prod state; `.env` is NOT prod config.
 *
 * Usage (needs prod env):
 *   railway run --service MAINnicks-tire-auto -- pnpm exec tsx scripts/probe-higgsfield-session-health.mts
 */
const { higgsfieldSessionHealth, getHiggsfieldCredentialsJson } = await import(
  "../server/services/higgsfieldStudio"
);

const present = Boolean(await getHiggsfieldCredentialsJson());
const health = await higgsfieldSessionHealth();

console.log("\n── Higgsfield session ──");
console.log(`credentials present : ${present}`);
console.log(`session healthy     : ${health.healthy === null ? "UNKNOWN" : health.healthy}`);
console.log(`reason              : ${health.reason}`);
console.log(`keepalive last ran  : ${health.checkedAt ? health.checkedAt.toISOString() : "never / unreadable"}`);

// The whole point of the change: these two disagreeing is the invisible state.
if (present && health.healthy === false) {
  console.log("\nVERDICT: credentials are STORED but the session is DEAD.");
  console.log("This is the state every presence-only check reported as 'configured'.");
  console.log("Operator action: re-login to Higgsfield (refresh token revoked).");
} else if (present && health.healthy === true) {
  console.log("\nVERDICT: session is live.");
} else if (!present) {
  console.log("\nVERDICT: no credentials stored at all.");
} else {
  console.log("\nVERDICT: cannot tell — treated as UNKNOWN, never as a clean bill.");
}
console.log("");

// The mysql pool keeps the event loop alive, so without this the process never
// exits — and when stdout is piped, nothing is flushed either, so the run looks
// like a hang with zero output rather than a completed probe.
process.exit(0);
