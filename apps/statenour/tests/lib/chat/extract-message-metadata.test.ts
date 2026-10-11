/**
 * tests/lib/chat/extract-message-metadata.test.ts — WP-11 (2026-07-29):
 * the quality extractor must pass the receipt + truth verdicts through
 * to the evidence panel, and must stay honest for messages without a
 * persisted blob.
 */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { extractQuality } from "@/lib/chat/extract-message-metadata";
import { qualityHasIssue } from "@/lib/ai/chat/quality-diagnostics";
import { QualityBar, type QualityPayload } from "@/components/chat/quality-bar";

describe("extractQuality (WP-11 reply-quality evidence)", () => {
  it("returns undefined for user messages and blob-less assistant messages", () => {
    expect(extractQuality({ role: "user", tokenUsage: { gate: {} } })).toBeUndefined();
    expect(extractQuality({ role: "assistant" })).toBeUndefined();
    expect(extractQuality({ role: "assistant", tokenUsage: { model: "m" } })).toBeUndefined();
  });

  it("passes gate/critic/factCheck through unchanged (pre-WP-11 contract preserved)", () => {
    const q = extractQuality({
      role: "assistant",
      tokenUsage: { gate: { severity: 40, reasons: ["r"] }, critic: { overall: 82 } },
    });
    expect(q?.gate?.severity).toBe(40);
    expect(q?.critic?.overall).toBe(82);
  });

  it("passes the receipt verdict through — a blob with ONLY a receipt still surfaces", () => {
    const q = extractQuality({
      role: "assistant",
      tokenUsage: {
        receipt: {
          ok: false,
          toolsFired: [{ toolName: "createTask", status: "failed" }],
          offenders: [{ toolName: "createTask", status: "failed", label: "create task" }],
        },
      },
    });
    expect(q?.receipt?.ok).toBe(false);
    expect(q?.receipt?.offenders?.[0]?.label).toBe("create task");
  });

  it("passes known-truth flags through", () => {
    const q = extractQuality({
      role: "assistant",
      tokenUsage: { truth: { total: 1, flags: [{ kind: "retired_infra", rule: "vercel" }] } },
    });
    expect(q?.truth?.total).toBe(1);
    expect(q?.truth?.flags?.[0]?.kind).toBe("retired_infra");
  });
});

// Audit 04-X9: the evidence-gate verdict was persisted at tokenUsage.evidenceGate
// and never shown next to the reply.
describe("extractQuality: the shadow evidence-gate verdict", () => {
  it("passes a non-pass verdict through, and it counts as an issue", () => {
    const q = extractQuality({
      role: "assistant",
      tokenUsage: { evidenceGate: { verdict: "block", shadowOnly: true, unreceipted: ["#ops-alerts"] } },
    });
    expect(q?.evidenceGate?.verdict).toBe("block");
    expect(qualityHasIssue(q)).toBe(true);
  });

  it("control: a pass verdict is not an issue", () => {
    const q = extractQuality({ role: "assistant", tokenUsage: { evidenceGate: { verdict: "pass", shadowOnly: true } } });
    expect(qualityHasIssue(q)).toBe(false);
  });

  it("the quality bar names it as shadow, not enforced; pass and absent render nothing", () => {
    const html = (payload: QualityPayload | undefined) =>
      renderToStaticMarkup(createElement(QualityBar, { payload }));
    expect(html({ evidenceGate: { verdict: "repair", shadowOnly: true } })).toContain(
      "evidence gate (shadow, not enforced): would repair",
    );
    expect(html({ evidenceGate: { verdict: "pass", shadowOnly: true } })).toBe("");
    expect(html({ critic: { overall: 95 } })).toBe("");
  });
});
