/**
 * The join between the environment verifier and the action receipt.
 *
 * Both halves existed and were tested. Neither informed the other: the
 * receipt was built from `{ toolName, ok }` at persist time and the verifier
 * ran after persist, feeding only a warning. Measured 2026-09-22 on the one
 * consequential chat turn since 09-15: `createTask` was read back from the
 * database and its receipt still said PROVIDER_ACCEPTED.
 *
 * `persist-assistant-message.ts` is a ~600-line function with no harness, so
 * the wiring is asserted from source — the repo's established shape for seams
 * that cannot be unit-tested (see the WIRING tests in
 * tests/ai/receipts/action-done-shadow-recorder.test.ts). Each assertion here
 * is one specific way the join could silently regress:
 *   · the verifier stops running before the receipt is built
 *   · promotion widens from `=== true` to truthiness (null would promote)
 *   · the post-persist consumer reverts to `!verified` (null would hedge)
 *   · the result stops being handed through, and the read-backs run twice
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const persist = readFileSync(
  resolve(process.cwd(), "lib/services/chat/persist-assistant-message.ts"),
  "utf8",
);
const postPersist = readFileSync(
  resolve(process.cwd(), "lib/services/chat/post-persist-verification.ts"),
  "utf8",
);
const verifier = readFileSync(resolve(process.cwd(), "lib/ai/chat/environment-verifier.ts"), "utf8");

/**
 * Match CODE, not commentary. The first run of this file failed on its own
 * "fail-open literal must not come back" assertion because the verifier's doc
 * comment quotes the retired literal as history. A source guard that cannot
 * tell a comment from a call site either forbids documenting the defect or
 * passes a live regression that happens to be commented — the repo learned
 * this on the nickstire guard sweep (match a call expression on
 * comment-stripped source). Crude but sufficient: block and line comments.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const verifierCode = stripComments(verifier);
const persistCode = stripComments(persist);
const postPersistCode = stripComments(postPersist);

describe("verifier → receipt join (source contract)", () => {
  it("runs the read-back BEFORE the receipts are built", () => {
    const verifyAt = persistCode.indexOf("await verifyEnvironmentState(capturedToolCalls)");
    const receiptAt = persistCode.indexOf("toReceipt({");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(receiptAt).toBeGreaterThan(-1);
    expect(verifyAt, "a read-back that runs after the receipt cannot inform it").toBeLessThan(receiptAt);
  });

  it("promotes a receipt on `verified === true` ONLY — null must never promote", () => {
    expect(persistCode).toMatch(/filter\(\(v\) => v\.verified === true\)/);
    // The receipt input is spread conditionally; there must be no path that
    // passes the verifier's raw value through as `verified`.
    expect(persistCode).not.toMatch(/verified:\s*v\.verified\b/);
    expect(persistCode).not.toMatch(/verified:\s*envVerification/);
  });

  it("the post-persist consumer hedges on `=== false` ONLY — null must never hedge", () => {
    expect(postPersistCode).toContain("if (check.verified === false)");
    expect(postPersistCode, "`!check.verified` treats not-checked as failed").not.toMatch(/if \(!check\.verified\)/);
  });

  it("post-persist reuses the persist-time result instead of running the read-backs twice", () => {
    expect(postPersistCode).toMatch(/a\.envVerification\s*\?\?/);
    expect(postPersistCode).toMatch(/envVerification\?:/);
    // ...and persist actually hands it on: the return carries it, the turn passes it.
    expect(persistCode).toMatch(/return \{ kind: "done", createdAssistantId, cleanedText, envVerification \}/);
    const turn = stripComments(
      readFileSync(resolve(process.cwd(), "lib/services/chat/persist-assistant-turn.ts"), "utf8"),
    );
    expect(turn).toMatch(/envVerification:\s*__persisted\.envVerification/);
  });

  it("the verifier is tri-state at the type level, and its no-verifier branch says null", () => {
    expect(verifierCode).toContain("verified: boolean | null;");
    expect(verifierCode).toMatch(/verified:\s*null,\s*reason:\s*"No specific environment verifier exists"/);
    expect(verifierCode, "the fail-open literal must not come back").not.toMatch(
      /verified:\s*true,\s*reason:\s*"No specific environment verifier exists"/,
    );
  });

  it("POSITIVE CONTROL: the comment stripper does not erase code", () => {
    // If stripping ever swallowed the call site, every assertion above would
    // fail loudly rather than pass vacuously — but assert it directly too.
    expect(verifierCode).toContain("export async function verifyEnvironmentState");
    expect(persistCode).toContain("toReceipt({");
  });
});
