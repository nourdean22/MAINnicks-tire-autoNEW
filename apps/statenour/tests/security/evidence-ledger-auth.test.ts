/**
 * The Reality Ledger door's key decision — the REAL function, not a copy.
 *
 * Why this exists: an unattended caller (Night Shift, the proof workflow) must
 * be able to hold ONE narrow credential. EVIDENCE_LEDGER_KEY opens
 * /api/sync/evidence; STATENOUR_SYNC_KEY (the whole cross-app bridge) still
 * opens it too so nickstire's cron keeps posting. Positive control first, then
 * every refusal that matters, then the scope claim itself: the bridge door's
 * own guard (`requireSyncAuth`) compares against STATENOUR_SYNC_KEY only, so a
 * scoped key can never open it — pinned here by driving the pure decision with
 * the bridge door's env shape.
 */
import { describe, it, expect } from "vitest";
import { evidenceDoorAccepts, presentedLedgerKey } from "@/lib/security/evidence-ledger-auth";

const LEDGER = "ledger-key-0123456789abcdef";
const BRIDGE = "bridge-key-fedcba9876543210";

describe("evidenceDoorAccepts", () => {
  it("positive control: the scoped key opens the door as 'ledger', the bridge key as 'bridge'", () => {
    const env = { EVIDENCE_LEDGER_KEY: LEDGER, STATENOUR_SYNC_KEY: BRIDGE };
    expect(evidenceDoorAccepts(LEDGER, env)).toBe("ledger");
    expect(evidenceDoorAccepts(BRIDGE, env)).toBe("bridge");
  });

  it("refuses a wrong key, an empty key, and a near-miss of the right length", () => {
    const env = { EVIDENCE_LEDGER_KEY: LEDGER, STATENOUR_SYNC_KEY: BRIDGE };
    expect(evidenceDoorAccepts("nope", env)).toBeNull();
    expect(evidenceDoorAccepts("", env)).toBeNull();
    expect(evidenceDoorAccepts(LEDGER.slice(0, -1) + "X", env)).toBeNull();
  });

  it("with the scoped key unset only the bridge key opens the door (status quo for nickstire's cron)", () => {
    const env = { EVIDENCE_LEDGER_KEY: undefined, STATENOUR_SYNC_KEY: BRIDGE };
    expect(evidenceDoorAccepts(BRIDGE, env)).toBe("bridge");
    expect(evidenceDoorAccepts(LEDGER, env)).toBeNull();
  });

  it("fails closed: nothing configured means nothing authenticates, not even an empty-for-empty match", () => {
    const env = { EVIDENCE_LEDGER_KEY: "", STATENOUR_SYNC_KEY: undefined };
    expect(evidenceDoorAccepts("", env)).toBeNull();
    expect(evidenceDoorAccepts("anything", env)).toBeNull();
  });

  it("scope: the scoped key is not a bridge key — the bridge door's env shape never sees it", () => {
    // requireSyncAuth compares against STATENOUR_SYNC_KEY alone. Model that door
    // as "ledger key absent" and prove the scoped credential opens nothing there.
    const bridgeDoor = { EVIDENCE_LEDGER_KEY: undefined, STATENOUR_SYNC_KEY: BRIDGE };
    expect(evidenceDoorAccepts(LEDGER, bridgeDoor)).toBeNull();
  });
});

describe("presentedLedgerKey", () => {
  it("reads x-sync-key first, then a Bearer token, and yields '' when neither is there", () => {
    expect(presentedLedgerKey(new Headers({ "x-sync-key": "a", authorization: "Bearer b" }))).toBe("a");
    expect(presentedLedgerKey(new Headers({ authorization: "Bearer b" }))).toBe("b");
    expect(presentedLedgerKey(new Headers({ authorization: "bearer c" }))).toBe("c");
    expect(presentedLedgerKey(new Headers())).toBe("");
  });
});
