/**
 * wave-181.73 · operator one-shot · drain the declined-work backlog NOW.
 *
 * Calls the same runDeclinedWorkRecovery() function the daily cron uses
 * — same code path, same safety guards (wave-181.59 at-most-once claim
 * via followUp{N}dAttemptedAt · wave-181.60 TCPA opt-out hoisted above
 * routing · wave-181.64 8AM-8PM ET sending window enforced per-message
 * by sms.ts queueForLater · wave-181.68 durable daily rate-limit).
 * Only the per-run cap and the dry-run gate are tunable.
 *
 * Why this exists instead of just waiting for the daily cron:
 *   The daily cron sends 20/run. The current backlog is ~323 estimates.
 *   At 20/day that's 16 days to drain. The operator wants the pipeline
 *   running NOW. F25e SMS Gateway can sustain ~3-5 sends/sec without
 *   carrier throttling so 323 sends takes 60-90 seconds.
 *
 * Usage:
 *   pnpm exec tsx scripts/fire-declined-recovery.ts
 *   pnpm exec tsx scripts/fire-declined-recovery.ts --max=100
 *   pnpm exec tsx scripts/fire-declined-recovery.ts --max=500 --confirm
 *
 * Flags:
 *   --max=N      · per-run cap override (default 50 · hard ceiling 500)
 *   --confirm    · skip the 10s "are you sure" pause (for known-good runs)
 *   --dry-run    · log what would send but don't actually fire SMS · runs
 *                  the eligibility query + opt-out check + claim attempt
 *                  but ABORTS before sendSms call. Useful for sizing.
 *
 * Safety: this script bypasses the FEATURE_DECLINED_RECOVERY env gate
 * (skipDryRunGate: true) because running this script IS the operator's
 * explicit consent. The daily cron's flag stays in effect for unattended
 * runs. Bypasses isBusinessHours() because customer-facing sends are
 * still gated by isWithinSendingHours() in sms.ts (per-message · queues
 * out-of-window sends for the next 8 AM ET).
 *
 * Out-of-hours behavior: if you run this at 11 PM, the messages get
 * inserted into the delayed_queue + persisted to DB, and the existing
 * processDelayedQueue cron drains them at 8 AM. No customer wakeup.
 */

import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

function parseArgs(): { max: number; confirm: boolean; dryRun: boolean } {
  const args = process.argv.slice(2);
  let max = 50;
  let confirm = false;
  let dryRun = false;
  for (const a of args) {
    if (a.startsWith("--max=")) {
      const n = Number(a.slice("--max=".length));
      if (Number.isFinite(n) && n > 0) max = Math.min(n, 500);
    } else if (a === "--confirm") {
      confirm = true;
    } else if (a === "--dry-run") {
      dryRun = true;
    }
  }
  return { max, confirm, dryRun };
}

async function main(): Promise<void> {
  const { max, confirm, dryRun } = parseArgs();
  console.log("\n═══ Wave-181.73 · Drain declined-work backlog ═══\n");
  console.log(`  Per-run cap : ${max}`);
  console.log(`  Mode        : ${dryRun ? "DRY-RUN (no SMS fires)" : "LIVE"}`);
  console.log(`  Dry-run gate: BYPASSED (operator-driven · explicit consent)`);
  console.log(`  Window gate : BYPASSED (per-message guard still in sms.ts)`);

  // wave-181.74 (operator-driven preflight) · the FIRST time this script
  // was run from a developer laptop, the local .env had stale Capevace
  // credentials. All 49 sends failed at the gateway (401 Unauthorized
  // on the shop path · Twilio dead on fallback). The at-most-once
  // claim stamped BEFORE the failure was known · locking those 49
  // customers out of future cron retries (recovered via scripts/
  // reset-stale-claims.ts). Adding a preflight probe so this script
  // refuses to run if it can't reach the gateway.
  if (!dryRun) {
    const url = process.env.SHOP_SMS_GATEWAY_URL || "https://api.sms-gate.app/3rdparty/v1";
    const username = process.env.SHOP_SMS_GATEWAY_USERNAME;
    const password = process.env.SHOP_SMS_GATEWAY_PASSWORD;
    if (!username || !password) {
      console.error("\n  ❌ ABORT · SHOP_SMS_GATEWAY_USERNAME or PASSWORD missing in .env.");
      console.error(`  This script must be run from the prod environment (Railway)`);
      console.error(`  where the F25e gateway credentials are configured.`);
      process.exit(2);
    }
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    try {
      const probe = await fetch(`${url}/device`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (probe.status === 401) {
        console.error(`\n  ❌ ABORT · gateway returned 401 Unauthorized.`);
        console.error(`  The SHOP_SMS_GATEWAY_USERNAME/PASSWORD in .env are stale or invalid.`);
        console.error(`  Run this script from the prod env (Railway) where creds are current.`);
        console.error(`  Alternative · flip FEATURE_DECLINED_RECOVERY=1 on Railway env and let`);
        console.error(`  the daily cron drain the backlog at 20/run cap.`);
        process.exit(3);
      }
      if (!probe.ok) {
        console.error(`\n  ❌ ABORT · gateway preflight returned status ${probe.status}.`);
        console.error(`  Check Capevace dashboard for the F25e device state.`);
        process.exit(4);
      }
      console.log(`  Gateway probe: ✓ ${probe.status} OK`);
    } catch (err) {
      console.error(`\n  ❌ ABORT · gateway probe network error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(5);
    }
  }

  if (!confirm && !dryRun) {
    console.log(`\n  Starting in 10 seconds · Ctrl-C to abort...`);
    for (let i = 10; i >= 1; i--) {
      process.stdout.write(`  ${i}...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log("\n");
  }

  const { runDeclinedWorkRecovery } = await import(
    "../server/cron/jobs/declinedWorkRecovery"
  );

  const start = Date.now();
  if (dryRun) {
    // DRY-RUN path · use the existing gate to surface what WOULD send.
    // wave-181.76 (self-audit · agent finding #2) · pre-fix, this branch
    // did `delete process.env.FEATURE_DECLINED_RECOVERY` to force the
    // dry-run report. That was redundant AND hazardous · the gate is
    // already off when `skipDryRunGate` isn't passed, AND mutating
    // process.env persists for the entire process lifetime (would
    // affect any future code in the same Node session). Just omit
    // skipDryRunGate · the cron defaults to dry-run when the env flag
    // is "1"-less.
    const result = await runDeclinedWorkRecovery({
      maxSends: max,
      bypassBusinessHoursCheck: true,
      // intentionally NOT skipDryRunGate · we want the dry-run report
    });
    console.log(`\nDRY-RUN result:`);
    console.log(JSON.stringify(result, null, 2));
  } else {
    const result = await runDeclinedWorkRecovery({
      maxSends: max,
      bypassBusinessHoursCheck: true,
      skipDryRunGate: true,
    });
    console.log(`\nLIVE result:`);
    console.log(JSON.stringify(result, null, 2));
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n═══ DONE · ${elapsed}s ═══`);
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
