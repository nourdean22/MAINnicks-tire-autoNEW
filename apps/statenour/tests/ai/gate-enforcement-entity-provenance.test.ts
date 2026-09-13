import { describe, expect, it } from "vitest";
import { enforceGate } from "@/lib/ai/chat/gate-enforcement";
import { checkNamedSources } from "@/lib/ai/chat/named-source-claims";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import type { GateEvidence } from "@/lib/ai/reply-gate";

const USER = "add a task to call John tomorrow";
const FAKE = "cmtyj6qr308v1mj011ae54upe";

function evidence(namedSources: ReturnType<typeof checkNamedSources>, text: string): GateEvidence {
  return {
    unverifiedFactCount: 0,
    totalFactCount: 0,
    wordCount: text.trim().split(/\s+/).filter(Boolean).length,
    lengthCeiling: 300,
    namedSources,
  };
}

function enforce(
  draft: string,
  receipts: { evidenceText: string; receiptsAvailable: boolean },
) {
  const report = checkNamedSources(draft, {
    toolCalls: receipts.evidenceText ? [{ name: "createTask" }] : [],
    evidenceText: receipts.evidenceText,
    receiptsAvailable: receipts.receiptsAvailable,
    userText: USER,
  });
  const ev = evidence(report, draft);

  return enforceGate({
    draft,
    userText: USER,
    critic: null,
    turnSignal: classifyTurn(USER),
    contract: null,
    evidence: ev,
    namedSources: report,
    ceilingWords: 300,
    reassess: (repaired) => {
      const next = checkNamedSources(repaired, {
        toolCalls: receipts.evidenceText ? [{ name: "createTask" }] : [],
        evidenceText: receipts.evidenceText,
        receiptsAvailable: receipts.receiptsAvailable,
        userText: USER,
      });
      return { evidence: evidence(next, repaired), namedSources: next };
    },
  });
}

describe("buffered structured entity-id enforcement", () => {
  it("removes a fabricated task-id sentence before release", () => {
    const draft = `I created task #${FAKE}. The useful next move is to call John.`;
    const out = enforce(draft, { evidenceText: "", receiptsAvailable: true });

    expect(out.text).toBe("The useful next move is to call John.");
    expect(out.text).not.toContain(FAKE);
    expect(out.actions.join(" ")).toMatch(/structured entity provenance violation/i);
    expect(out.actions.join(" ")).toMatch(/no provenance/i);
    expect(out.usedFallback).toBe(false);
  });

  it("keeps the task id when this turn's tool result emitted it", () => {
    const draft = `Created task id: ${FAKE}.`;
    const out = enforce(draft, {
      evidenceText: JSON.stringify({ ok: true, id: FAKE }),
      receiptsAvailable: true,
    });

    expect(out.text).toBe(draft);
    expect(out.actions).toHaveLength(0);
  });

  it("does not delete an id when the receipt channel itself is blind", () => {
    const draft = `Created task id: ${FAKE}.`;
    const report = checkNamedSources(draft, {
      toolCalls: [],
      evidenceText: "",
      receiptsAvailable: false,
      userText: USER,
    });
    expect(report.entityClaimsBlind).toBe(true);
    expect(report.unsupportedEntityClaims).toEqual([]);

    const out = enforce(draft, { evidenceText: "", receiptsAvailable: false });
    expect(out.text).toBe(draft);
    expect(out.actions).toHaveLength(0);
  });
});
