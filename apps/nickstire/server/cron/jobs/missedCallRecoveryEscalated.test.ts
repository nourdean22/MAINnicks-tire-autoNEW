/**
 * 2026-11-06 · escalate stopped writing a callback row. That row was also the capture
 * evidence that kept an escalated call out of the missed-call lanes, so without a
 * replacement every after-hours escalate would come back as a recovery text or a
 * "Missed call (name unknown) · Please call back" row. escalate now leaves a
 * `voice-escalated:<callId>` marker and the capture evidence reads it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../db", async (orig) => ({ ...(await orig<typeof import("../../db")>()), getDb: async () => ({ execute: h.execute }) }));

import { proveCapturedNothing } from "./missedCallRecovery";
import { loadCallCaptureEvidence } from "../../services/vapiActionExtraction";

const evidenceRow = (over: Record<string, unknown>) => [[{ leadId: null, callbackId: null, convertedToLead: 1, hasCallback: 0, hasArrival: 0, escalated: 0, ...over }]];

function boundStrings(node: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof node === "string") { out.push(node); return out; }
  if (!node || typeof node !== "object" || seen.has(node)) return out;
  seen.add(node);
  const v = (node as { value?: unknown }).value;
  if (typeof v === "string") out.push(v);
  for (const c of ((node as { queryChunks?: unknown[] }).queryChunks ?? [])) boundStrings(c, out, seen);
  return out;
}

describe("an escalated call is handled, not a missed call", () => {
  beforeEach(() => h.execute.mockReset());

  it("the capture evidence asks for the escalate marker of this call", async () => {
    h.execute.mockResolvedValueOnce(evidenceRow({ escalated: 1 }));
    const ev = await loadCallCaptureEvidence("call_e1");
    expect(boundStrings(h.execute.mock.calls[0][0])).toContain("voice-escalated:call_e1");
    expect(ev).toMatchObject({ escalated: true });
  });

  it("proveCapturedNothing is false for an escalated call", async () => {
    h.execute.mockResolvedValueOnce(evidenceRow({ escalated: 1 }));
    expect(await proveCapturedNothing("call_e2")).toBe(false);
  });

  it("POSITIVE CONTROL: a tool call that captured nothing and was not escalated is proven", async () => {
    h.execute.mockResolvedValueOnce(evidenceRow({ escalated: 0 }));
    expect(await proveCapturedNothing("call_e3")).toBe(true);
  });
});
