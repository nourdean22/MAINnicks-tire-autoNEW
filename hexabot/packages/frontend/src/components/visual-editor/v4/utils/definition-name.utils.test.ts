/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowDefinition } from "@hexabot-ai/agentic";
import { describe, expect, it } from "vitest";

import {
  createUniqueDefinitionName,
  isDefinitionNameAvailable,
  normalizeDefinitionName,
} from "./definition-name.utils";

const defs: WorkflowDefinition["defs"] = {
  search: {
    kind: "tools",
    action: "search",
    settings: {},
  },
  search_2: {
    kind: "task",
    action: "search",
  },
};

describe("definition-name.utils", () => {
  it("normalizes definition names", () => {
    expect(normalizeDefinitionName(" Retrieve RAG Content ")).toBe(
      "retrieve_rag_content",
    );
  });

  it("generates names across all definition kinds", () => {
    expect(createUniqueDefinitionName("Search", defs)).toBe("search_3");
    expect(createUniqueDefinitionName("", defs, "new_task")).toBe("new_task");
  });

  it("allows the current name but rejects another definition name on update", () => {
    expect(isDefinitionNameAvailable("search", defs, "search")).toBe(true);
    expect(isDefinitionNameAvailable("search_2", defs, "search")).toBe(false);
  });
});
