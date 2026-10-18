/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  DEFAULT_RETRY_SETTINGS,
  DEFAULT_TIMEOUT_MS,
  type WorkflowDefinition,
} from "@hexabot-ai/agentic";
import { parse as parseYaml } from "yaml";

import { isRecord } from "@/utils/object";

/**
 * Build a minimal workflow definition with defaults and optional metadata.
 */
export const createBaseDefinition = (): WorkflowDefinition => ({
  defaults: {
    settings: {
      timeout_ms: DEFAULT_TIMEOUT_MS,
      retries: { ...DEFAULT_RETRY_SETTINGS },
    },
  },
  defs: {},
  flow: [],
  outputs: {},
});

export const extractDefsFromYaml = (yaml: string): Record<string, unknown> => {
  try {
    const parsed = parseYaml(yaml);

    return isRecord(parsed) && isRecord(parsed.defs) ? parsed.defs : {};
  } catch {
    return {};
  }
};
export const extractDefinitionNamesByKind = (
  defs: Record<string, unknown>,
  kind: string,
): string[] =>
  Object.keys(defs).filter((name) => {
    const definition = defs[name];

    return isRecord(definition) && definition.kind === kind;
  });
