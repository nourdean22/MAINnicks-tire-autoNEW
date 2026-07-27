/**
 * A voice call that creates a lead must record WHICH lead.
 *
 * THE MEASURED BREAK
 * `vapi_call_logs.leadId` is the only call -> lead foreign key. Against
 * production:
 *
 *   total rows          2,136
 *   leadId NOT NULL         0
 *   callbackId NOT NULL     0
 *   convertedToLead = 1   525
 *
 * So the shop knew 525 calls had produced a lead and could not say WHICH lead.
 * Every downstream question — did that call earn revenue, which intent
 * converts, what is a voice lead worth — dies at the first hop.
 *
 * WHY IT WAS ZERO
 * The only writer is a mid-call
 * `UPDATE vapi_call_logs SET leadId ... WHERE vapiCallId = ?` inside
 * `voiceAgent.tireInquiry`. The row is INSERTED by the END-OF-CALL webhook, so
 * during the call there is nothing to update. The UPDATE matched zero rows,
 * every time, and reported no error — an update that matches nothing is not a
 * failure in SQL.
 *
 * THE FIX
 * The tool records the id on the call-state trail, which is durable, written
 * during the call, and ALREADY read by the same webhook to compute
 * `convertedToLead` — a path proven to work on 525 rows. The webhook picks the
 * id out of the trail and writes it at INSERT time.
 *
 * These tests pin the extraction logic and the wiring. The DB round-trip is not
 * simulated; what is asserted is that the id can survive the trail and that
 * both ends still reference it.
 */
import { describe, expect, it } from "vitest";
import { trailReachedTool } from "./services/vapiConversionSignals";

/** A positive integer or nothing — mirrors the webhook's `fkFrom`. */
const fkFrom = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The extraction the webhook performs over `getCallStateHistory()` output. */
function idsFromTrail(history: Array<{ metadata: Record<string, unknown> | null }>) {
  let leadId: number | null = null;
  let callbackId: number | null = null;
  for (const entry of history) {
    const md = entry.metadata as { leadId?: unknown; callbackId?: unknown } | null;
    leadId = fkFrom(md?.leadId) ?? leadId;
    callbackId = fkFrom(md?.callbackId) ?? callbackId;
  }
  return { leadId, callbackId };
}

const leadIdFromTrail = (h: Array<{ metadata: Record<string, unknown> | null }>) => idsFromTrail(h).leadId;

const entry = (state: string, metadata: Record<string, unknown> | null = null) =>
  ({ state, at: new Date(0), metadata }) as never;

describe("leadId survives the call-state trail", () => {
  it("extracts the id a tool recorded", () => {
    const history = [
      { state: "greeted", metadata: null },
      { state: "tool_called", metadata: { tool: "tireInquiry", leadId: 4210 } },
      { state: "ended", metadata: null },
    ];
    expect(leadIdFromTrail(history)).toBe(4210);
  });

  it("returns null when no tool created a lead — absence must not become 0", () => {
    // 0 is a valid-looking FK and would be a corrupt link. Null means "no lead".
    expect(leadIdFromTrail([{ state: "greeted", metadata: null }])).toBeNull();
    expect(leadIdFromTrail([{ state: "tool_called", metadata: { tool: "shopInfo" } }])).toBeNull();
  });

  it("ignores junk rather than writing a bad foreign key", () => {
    for (const bad of [0, -1, 1.5, "", "abc", null, undefined, {}, []]) {
      expect(leadIdFromTrail([{ state: "tool_called", metadata: { leadId: bad } }]), `accepted: ${JSON.stringify(bad)}`)
        .toBeNull();
    }
  });

  it("a numeric string still links — the metadata column is JSON", () => {
    expect(leadIdFromTrail([{ state: "tool_called", metadata: { leadId: "4210" } }])).toBe(4210);
  });

  it("last writer wins when a call created more than one", () => {
    const history = [
      { state: "tool_called", metadata: { tool: "tireInquiry", leadId: 1 } },
      { state: "tool_called", metadata: { tool: "tireInquiry", leadId: 2 } },
    ];
    expect(leadIdFromTrail(history)).toBe(2);
  });
});

/**
 * `callbackId` had the SAME hole and a worse version of it: the identifier
 * appeared nowhere in voiceAgent.ts at all — `escalate` inserted the callback
 * row and never attempted a link.
 *
 * The cost is not cosmetic. `hasVerifiedDemandCapture` is
 * `leadCreated || callbackCreated || bookingCreated`, and production shows all
 * three permanently false: across 482 measured calls — 209 of which engaged a
 * tool, with 24 real callback_requests rows on the books — the metric has never
 * once been true, so the daily digest has reported
 * "Verified lead/callback capture: 0" every single day.
 */
describe("callbackId rides the same trail", () => {
  it("extracts a callbackId an escalate call recorded", () => {
    const { callbackId } = idsFromTrail([
      { state: "greeted", metadata: null },
      { state: "tool_called", metadata: { tool: "escalate", callbackId: 77 } },
    ] as never);
    expect(callbackId).toBe(77);
  });

  it("carries BOTH ids when one call did both", () => {
    const ids = idsFromTrail([
      { state: "tool_called", metadata: { tool: "tireInquiry", leadId: 12 } },
      { state: "tool_called", metadata: { tool: "escalate", callbackId: 34 } },
    ] as never);
    expect(ids).toEqual({ leadId: 12, callbackId: 34 });
  });

  it("a lead does not leak into the callback slot or vice versa", () => {
    const ids = idsFromTrail([{ state: "tool_called", metadata: { tool: "tireInquiry", leadId: 9 } }] as never);
    expect(ids.leadId).toBe(9);
    expect(ids.callbackId).toBeNull();
  });

  it("rejects junk callbackIds too", () => {
    for (const bad of [0, -3, 2.5, "", "x", null, undefined]) {
      expect(idsFromTrail([{ state: "tool_called", metadata: { callbackId: bad } }] as never).callbackId).toBeNull();
    }
  });
});

describe("the extra trail event cannot distort convertedToLead", () => {
  it("trailReachedTool is an existence check, so a duplicate state is idempotent", () => {
    const once = [entry("tool_called", { tool: "tireInquiry" })];
    const twice = [...once, entry("tool_called", { tool: "tireInquiry", leadId: 7 })];
    expect(trailReachedTool(once)).toBe(true);
    expect(trailReachedTool(twice)).toBe(true);
  });

  it("still false when no tool ever fired", () => {
    expect(trailReachedTool([entry("greeted"), entry("ended")])).toBe(false);
  });
});

/**
 * These source assertions check that the CALL EXISTS — they cannot check that
 * it RESOLVES. This bit during development: the recording call was written with
 * `../../services/voice-call-state` (correct from the webhook's directory, wrong
 * from the router's). Every test below still passed, because the import is
 * dynamic and sits inside a try/catch that swallows by design so telemetry can
 * never break a live call.
 *
 * `tsc` caught it; the suite could not. Module resolution is therefore left to
 * typecheck rather than duplicated as a brittle path regex here — the point is
 * that a green run of THIS file is not evidence the import works.
 */
describe("both ends are actually wired", () => {
  const read = async (p: string) => {
    const { readFileSync } = await import("node:fs");
    return readFileSync(new URL(p, import.meta.url), "utf8");
  };

  it("the tool records leadId on the trail", async () => {
    const s = await read("./routers/voiceAgent.ts");
    expect(s).toMatch(/recordCallState\(\{[\s\S]{0,200}leadId: newLeadId/);
  });

  it("the escalate tool records callbackId on the trail", async () => {
    const s = await read("./routers/voiceAgent.ts");
    expect(s).toMatch(/recordCallState\(\{[\s\S]{0,240}callbackId: Number\(insertedCallback\.insertId\)/);
  });

  it("the webhook extracts BOTH ids and writes them at INSERT", async () => {
    const s = await read("./routes/webhooks/vapi.ts");
    expect(s).toMatch(/leadId: trailLeadId/);
    expect(s).toMatch(/callbackId: trailCallbackId/);
  });

  /**
   * Review catch (P2). `getCallStateHistory()` fails open to [] — correct, a
   * telemetry read must never break the webhook's 200. But that meant a
   * transient read failure on the FIRST delivery inserted null ids, and VAPI's
   * retry — which may read the trail fine — would hit dup-key, set
   * firstLog=false, and leave the row permanently unlinked. A recoverable blip
   * becoming a permanent hole in the very linkage this change creates.
   */
  it("backfills the ids when a duplicate delivery finally has them", async () => {
    const s = await read("./routes/webhooks/vapi.ts");
    expect(s).toMatch(/if \(!firstLog && \(trailLeadId != null \|\| trailCallbackId != null\)\)/);
    expect(s).toMatch(/UPDATE vapi_call_logs/);
  });

  it("the backfill can only FILL a null, never overwrite a value", async () => {
    const s = await read("./routes/webhooks/vapi.ts");
    expect(s).toMatch(/leadId\s*=\s*COALESCE\(leadId,/);
    expect(s).toMatch(/callbackId = COALESCE\(callbackId,/);
    expect(s).toMatch(/AND \(leadId IS NULL OR callbackId IS NULL\)/);
  });

  it("the backfill does NOT replay the one-time side effects", async () => {
    // Those stay gated on `firstLog`; only the two id columns are touched.
    const s = await read("./routes/webhooks/vapi.ts");
    const block = s.slice(s.indexOf("BACKFILL THE IDS"), s.indexOf("BACKFILL THE IDS") + 1400);
    expect(block).toMatch(/SET leadId\s*=\s*COALESCE/);
    expect(block).not.toMatch(/insert\(/);
    expect(block).not.toMatch(/sendTelegram/);
  });

  it("the webhook reads the history ONCE and reuses it", async () => {
    // Guards a naive refactor that re-queries per use — this runs on every
    // end-of-call webhook.
    const s = await read("./routes/webhooks/vapi.ts");
    expect(s).toMatch(/const history = await getCallStateHistory/);
  });
});
