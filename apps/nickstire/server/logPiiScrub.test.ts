/**
 * The scrubbed log lines stay scrubbed.
 *
 * WHY A TEST AND NOT JUST THE LINTER. lint:pii runs in STAGED-DIFF mode during
 * `verify`, so it only sees files the current commit touches. A future edit
 * that reintroduces a name into one of these lines would be caught — but only
 * if that same commit also happens to stage the file, and only if the linter's
 * pattern still covers the shape used. This asserts the files directly, so the
 * property holds regardless of what a given commit stages.
 *
 * WHAT WAS WRONG (2026-09-10). server/lib/logger.ts performs no redaction of
 * any kind: it lifts .message/.stack, JSON.stringifies, and writes to stdout —
 * on Railway, the log retention window. Thirteen log.* lines were interpolating
 * customer first names, full names, phones and emails. lint-pii could not see
 * any of them: its template-literal rules covered console.* and new Error(),
 * never log.*, which is the logger server code actually calls.
 *
 * The rule at every site: keep the CONDITION and an opaque id, drop the person.
 * No line was deleted — a log that proves a branch executed is evidence, and
 * removing it to satisfy a linter would trade one blindness for another.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP = process.cwd();

/**
 * Interpolations that put a PERSON into a log message.
 *
 * OWNER-QUALIFIED deliberately. A bare `\.name\b` also matches
 * `${campaign.name}`, `${job.name}` and `${rule.name}` — none of which is a
 * person — and a guard that flags correct code is one the next reader learns
 * to route around. This is the same mention-vs-execution discipline the
 * hardcoded-phone rule needed in lint-pii.mjs: match the thing, not its shape.
 */
const PII_INTERPOLATION =
  /\$\{[^}]*(firstName|lastName|customerName|customerPhone|customerEmail|\b(customer|cust|data|req|order|enrollment|params|rc|lead|applicant|referrer)\.(name|phone|email)\b|refPhone|referrerPhone|referrerEmail)[^}]*\}/i;

/** `// pii-allow: <reason>` — the linter's own waiver, reason required. */
const WAIVED = /\/\/\s*pii-allow:\s*\S+/;

const SCRUBBED = [
  "server/cron/jobs/confirmationCalls.ts",
  "server/cron/jobs/followupCadence.ts",
  "server/cron/jobs/voiceRecovery.ts",
  "server/routers/reviewRequests.ts",
  "server/routers/services.ts",
  "server/services/customerMessageTemplates.ts",
  "server/services/dripProcessor.ts",
  "server/services/emailCampaigns.ts",
  "server/services/payments.ts",
  "server/services/shopDriverMirror.ts",
  "server/services/workOrderAutomation.ts",
];

describe("no customer PII reaches stdout through log.*", () => {
  for (const rel of SCRUBBED) {
    it(`${rel} has no PII-bearing log interpolation`, () => {
      const lines = readFileSync(resolve(APP, rel), "utf8").split("\n");
      const offenders = lines
        .map((l, i) => ({ l, n: i + 1 }))
        .filter(({ l }) => /\blog\.(log|info|warn|error|debug|trace)\s*\(/.test(l))
        .filter(({ l }) => PII_INTERPOLATION.test(l))
        .filter(({ l }) => !WAIVED.test(l))
        .map(({ l, n }) => `${rel}:${n}  ${l.trim().slice(0, 110)}`);

      expect(
        offenders,
        "logger.ts does not redact — this goes straight to the Railway log retention window. " +
          "Log an opaque id and the condition instead, or add a `// pii-allow: <reason>` if the " +
          "value is genuinely already masked.\n  " + offenders.join("\n  "),
      ).toEqual([]);
    });
  }

  it("the detector actually fires — the positive control", () => {
    // Without this, a regex that silently matched nothing would make every
    // assertion above vacuously pass. These are the exact shapes that shipped.
    const shipped = [
      "log.info(`[confirmation-calls] placed VAPI call ${call.callId} for booking ${b.id} (${firstName})`);",
      "log.error(`Failed to send confirmation SMS to ${order.customerPhone}:`, e);",
      "log.warn(`Drip step failed for ${enrollment.customerName}: ${msg}`);",
      "log.info(`Lead already exists for phone ${data.phone} (lead #${recent.id})`);",
    ];
    for (const line of shipped) {
      expect(PII_INTERPOLATION.test(line), `missed: ${line}`).toBe(true);
    }
  });

  it("stands down on an opaque id and on a documented waiver", () => {
    // The deny half needs a matching allow half, or the guard is just noise.
    expect(
      PII_INTERPOLATION.test("log.info(`Drip enrolled: campaign ${params.campaignId}`);"),
    ).toBe(false);
    expect(
      PII_INTERPOLATION.test("log.warn(`Email send failed for customer #${cust.id}`);"),
    ).toBe(false);
    // phoneTail is masked to 4 digits one line above its use, and carries the
    // linter's own waiver — the test must honour the same marker the linter does.
    const masked =
      "log.warn(`Failed to upsert customer ...${phoneTail}`, { error: e }); // pii-allow: masked to last 4";
    expect(PII_INTERPOLATION.test(masked) && !WAIVED.test(masked)).toBe(false);
  });
});
