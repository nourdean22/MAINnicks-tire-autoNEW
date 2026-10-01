import { afterEach, describe, expect, it } from "vitest";
import { __resetCircuits, circuitOpen, circuitSnapshot, classifyProviderFailure, closeCircuit, tripCircuit } from "./imageProviderCircuit";

afterEach(() => __resetCircuits());

const HIGGS = new Error('Higgsfield CLI exited with code 3. Stderr: Error: {"billing_period":"monthly","error_type":"not_enough_credits","plan_type":"ultra"}');
const OPENROUTER = new Error('OpenRouter image generation failed (402 Payment Required): {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits"}}');
const HF = new Error('Hugging Face image generation failed (410 Gone): {"error":"The requested model is deprecated and no longer supported by provider hf-inference"}');

describe("classifyProviderFailure — the three live failure shapes from Railway 2026-09-29..10-01", () => {
  it("credits", () => {
    expect(classifyProviderFailure(HIGGS)).toBe("credits");
    expect(classifyProviderFailure(OPENROUTER)).toBe("credits");
  });
  it("retired", () => expect(classifyProviderFailure(HF)).toBe("retired"));
  it("transient for everything else", () => {
    expect(classifyProviderFailure(new Error("fetch failed: ETIMEDOUT"))).toBe("transient");
    expect(classifyProviderFailure(new Error("500 Internal Server Error"))).toBe("transient");
    expect(classifyProviderFailure("string error")).toBe("transient");
  });
});

describe("circuit lifecycle", () => {
  it("POSITIVE CONTROL: before a trip the provider is tried (circuit closed)", () => {
    expect(circuitOpen("higgsfield")).toBeNull();
  });
  it("a credits failure opens the circuit for 6h, then it self-heals", () => {
    const t0 = 1_000_000;
    expect(tripCircuit("higgsfield", HIGGS, t0)).toBe("credits");
    expect(circuitOpen("higgsfield", t0 + 1)).toMatchObject({ klass: "credits" });
    expect(circuitOpen("higgsfield", t0 + 6 * 3600_000 - 1)).not.toBeNull();
    expect(circuitOpen("higgsfield", t0 + 6 * 3600_000)).toBeNull();
  });
  it("a retired model opens for 24h", () => {
    const t0 = 5_000;
    tripCircuit("openrouter", HF, t0);
    expect(circuitOpen("openrouter", t0 + 23 * 3600_000)).toMatchObject({ klass: "retired" });
    expect(circuitOpen("openrouter", t0 + 24 * 3600_000)).toBeNull();
  });
  it("a transient failure never opens the circuit", () => {
    expect(tripCircuit("openrouter", new Error("ETIMEDOUT"))).toBe("transient");
    expect(circuitOpen("openrouter")).toBeNull();
  });
  it("a success closes an open circuit immediately (top-up landed)", () => {
    tripCircuit("higgsfield", HIGGS);
    closeCircuit("higgsfield");
    expect(circuitOpen("higgsfield")).toBeNull();
  });
  it("snapshot lists only open circuits with their cause", () => {
    const t0 = 10;
    tripCircuit("higgsfield", HIGGS, t0);
    tripCircuit("openrouter", OPENROUTER, t0);
    const snap = circuitSnapshot(t0 + 1);
    expect(snap.map((s) => s.provider).sort()).toEqual(["higgsfield", "openrouter"]);
    expect(snap[0].reason).toContain("credits");
    expect(circuitSnapshot(t0 + 7 * 3600_000)).toEqual([]);
  });
});
