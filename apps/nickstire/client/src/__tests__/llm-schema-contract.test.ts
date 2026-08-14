/**
 * buildSchemaContractMessage — the Ollama-lane schema restatement.
 *
 * Ollama Cloud accepts response_format.json_schema but does not forward the
 * schema to the model (probed live 2026-08-14: deepseek-v4-pro invented
 * snake_case keys and every camelCase lookup coerced to ""/[], shipping reel
 * briefs with 0 beats and no caption). invokeLLM appends this contract
 * message on the Ollama lane so the model actually sees the schema. These
 * tests pin the helper's mechanism: WHEN it fires and that the schema the
 * model must follow is carried verbatim.
 */
import { describe, it, expect } from "vitest";
import { buildSchemaContractMessage } from "../../../server/_core/llm";

const SCHEMA = {
  type: "object",
  properties: {
    storyboardBeats: { type: "array", items: { type: "object" } },
    selectedCaption: { type: "string" },
  },
  required: ["storyboardBeats", "selectedCaption"],
};

describe("buildSchemaContractMessage", () => {
  it("returns a system message carrying the schema verbatim for json_schema formats", () => {
    const msg = buildSchemaContractMessage({
      type: "json_schema",
      json_schema: { name: "reel_brief", schema: SCHEMA },
    });
    expect(msg).not.toBeNull();
    expect(msg!.role).toBe("system");
    // The exact property names are the whole point — the defect was the model
    // never seeing them and inventing snake_case.
    expect(msg!.content).toContain(JSON.stringify(SCHEMA));
    expect(msg!.content).toContain("storyboardBeats");
    expect(msg!.content).toContain("selectedCaption");
  });

  it("returns null when there is no response format", () => {
    expect(buildSchemaContractMessage(undefined)).toBeNull();
  });

  it("returns null for non-schema formats (text / json_object)", () => {
    expect(buildSchemaContractMessage({ type: "text" })).toBeNull();
    expect(buildSchemaContractMessage({ type: "json_object" })).toBeNull();
  });

  it("returns null for a json_schema format missing the schema body", () => {
    expect(
      buildSchemaContractMessage({ type: "json_schema", json_schema: { name: "empty" } as never }),
    ).toBeNull();
  });
});
