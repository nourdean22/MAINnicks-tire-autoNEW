/**
 * tests/observability/otel-export.test.ts — WP-20 export lane (2026-08-03).
 *
 * otel-genai-map.test.ts proves the mapper's SHAPE for sampled inputs.
 * These prove the LANE: that content columns never leave the database,
 * that an unapproved attribute aborts the run instead of being dropped,
 * that a mistyped window cannot silently mean "everything", and that
 * the CLI cannot write to the database it points at.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_TRACE_EXPORT_SELECT,
  ExportPolicyError,
  FORBIDDEN_EXPORT_COLUMNS,
  enforceAllowlist,
  parseSince,
  toExportLine,
} from "@/lib/observability/otel-export";
import { ALLOWED_ATTRIBUTE_KEYS, type AgentTraceLike } from "@/lib/observability/otel-genai-map";

const trace: AgentTraceLike = {
  traceId: "trc_1",
  source: "chat",
  provider: "anthropic",
  model: "claude-opus-5",
  label: "main turn",
  durationMs: 1200,
  inputChars: 900,
  outputChars: 400,
  costCents: 3,
  toolCalls: 2,
};

describe("the export select never reads content columns", () => {
  const selected = Object.keys(AGENT_TRACE_EXPORT_SELECT);

  it.each(FORBIDDEN_EXPORT_COLUMNS)("does not select %s", (col) => {
    // errorMessage is @db.Text and metadata is Json — both can carry
    // prompt/argument/free-form content. A bare findMany() would pull
    // them into memory; the explicit select is what keeps them in the DB.
    expect(selected).not.toContain(col);
  });

  it("selects only fields the mapper knows how to redact", () => {
    const mapperInputs: (keyof AgentTraceLike)[] = [
      "traceId", "parentId", "source", "provider", "model", "label",
      "durationMs", "inputChars", "outputChars", "costCents", "toolCalls",
    ];
    expect(selected.sort()).toEqual([...mapperInputs].sort());
  });
});

describe("enforceAllowlist fails the export rather than dropping data", () => {
  it("accepts a span whose keys are all on the allowlist", () => {
    expect(() => enforceAllowlist({
      name: "chat", traceId: "t", attributes: { "gen_ai.operation.name": "chat" },
      recordedInputs: false, recordedOutputs: false, redactionVersion: "v",
    })).not.toThrow();
  });

  it("THROWS on an unapproved key — a silent skip would ship an incomplete file that looks fine", () => {
    expect(() => enforceAllowlist({
      name: "chat", traceId: "t",
      attributes: { "gen_ai.operation.name": "chat", "gen_ai.prompt.0.content": "secret" },
      recordedInputs: false, recordedOutputs: false, redactionVersion: "v",
    })).toThrow(ExportPolicyError);
  });

  it("names the offending key and points at the allowlist", () => {
    expect(() => enforceAllowlist({
      name: "chat", traceId: "trc_9", attributes: { "llm.input_messages": "x" },
      recordedInputs: false, recordedOutputs: false, redactionVersion: "v",
    })).toThrow(/llm\.input_messages.*ALLOWED_ATTRIBUTE_KEYS/s);
  });
});

describe("toExportLine emits valid NDJSON", () => {
  it("produces exactly one line", () => {
    expect(toExportLine(trace)).not.toContain("\n");
  });

  it("round-trips and carries only allowlisted attributes", () => {
    const parsed = JSON.parse(toExportLine(trace));
    expect(parsed.traceId).toBe("trc_1");
    expect(parsed.recordedInputs).toBe(false);
    for (const key of Object.keys(parsed.attributes)) {
      expect(ALLOWED_ATTRIBUTE_KEYS).toContain(key);
    }
  });
});

describe("parseSince refuses to guess", () => {
  const now = new Date("2026-08-03T12:00:00Z");

  it.each([
    ["30m", "2026-08-03T11:30:00.000Z"],
    ["24h", "2026-08-02T12:00:00.000Z"],
    ["7d", "2026-07-27T12:00:00.000Z"],
  ])("parses the relative window %s", (spec, expected) => {
    expect(parseSince(spec, now).toISOString()).toBe(expected);
  });

  it("accepts an ISO-8601 instant", () => {
    expect(parseSince("2026-01-01T00:00:00Z", now).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it.each(["yesterday", "7", "d7", "-3d", "0h", ""])(
    "throws on unparseable window %s rather than defaulting",
    (spec) => {
      // A mistyped window that silently became "everything" would dump
      // the entire trace history into an export file.
      expect(() => parseSince(spec, now)).toThrow();
    },
  );
});

describe("the export CLI is read-only by construction", () => {
  const src = readFileSync(
    new URL("../../scripts/export-otel-traces.ts", import.meta.url),
    "utf8",
  );

  // Method-call shapes, so the file's own prose ("no create/update/
  // delete/executeRaw anywhere") cannot satisfy or trip the scan.
  it.each([
    ["create", /\.create(Many)?\s*\(/],
    ["update", /\.update(Many)?\s*\(/],
    ["delete", /\.delete(Many)?\s*\(/],
    ["upsert", /\.upsert\s*\(/],
    ["raw execute", /\$executeRaw/],
    ["raw query", /\$queryRaw/],
  ])("contains no %s call", (_label, pattern) => {
    expect(src).not.toMatch(pattern);
  });

  it("still actually reads traces (the scan above is not passing by vacuity)", () => {
    expect(src).toMatch(/agentTrace\.findMany\s*\(/);
  });
});
