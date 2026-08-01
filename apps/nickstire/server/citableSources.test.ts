import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PUBLIC_SOURCE_REGISTRY, parseEvidenceHandle } from "./services/evidenceResolver";

/**
 * The generator used to be told "the label alone is enough" and did exactly
 * what that permits: it invented plausible source names. Measured over 12 real
 * briefs, 11 carried a claim with no citable evidence.
 */
describe("the prompt is rendered FROM the registry, not hardcoded", () => {
  const src = fs.readFileSync(path.join(__dirname, "services", "reelBriefGen.ts"), "utf8");

  it("builds the citable list from PUBLIC_SOURCE_REGISTRY", () => {
    // A hardcoded list would drift from the resolver and reintroduce the same
    // failure silently — the model citing sources the resolver rejects.
    expect(src).toContain("PUBLIC_SOURCE_REGISTRY.map");
    expect(src).toContain("renderCitableSources()");
  });

  it("no longer tells the model a bare label is acceptable", () => {
    expect(src).not.toContain("The label alone is enough");
  });

  it("keeps the honest escape hatch", () => {
    // Better a brief that says it cannot ground a claim than one that invents
    // a citation to satisfy the gate.
    expect(src).toMatch(/cannot ground/i);
  });
});

describe("the label format the prompt teaches actually resolves", () => {
  it("every registry record is reachable by the taught label shape", () => {
    // The prompt tells the model to write "<source name> <topic> guidance".
    // If that shape did not resolve, the instruction would be worse than
    // useless — it would look like compliance and still fail.
    for (const record of PUBLIC_SOURCE_REGISTRY) {
      const name = record.matchAliases?.[0] ?? record.family;
      const label = `${name} ${record.topics[0]} guidance`;
      const parsed = parseEvidenceHandle(label);
      expect(parsed.type, `label "${label}"`).toBe("public_source");
    }
  });

  it("still rejects an invented source, which is the whole point", () => {
    for (const invented of [
      "Tire Industry Association (TIA) Repair Manual",
      "Goodyear Tire Care Information",
      "Ohio Department of Transportation - Salt Usage",
    ]) {
      expect(parseEvidenceHandle(invented).type).not.toBe("public_source");
    }
  });

  it("a family name with no topic does not resolve — recognition is not evidence", () => {
    expect(parseEvidenceHandle("NHTSA says so").type).not.toBe("public_source");
  });
});
