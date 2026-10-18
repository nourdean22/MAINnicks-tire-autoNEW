/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { toSnakeCase, type WorkflowDefinition } from "@hexabot-ai/agentic";

type WorkflowDefinitions = WorkflowDefinition["defs"] | undefined;

export const normalizeDefinitionName = (value: string): string =>
  toSnakeCase(value.trim());

export const isDefinitionNameAvailable = (
  name: string,
  defs: WorkflowDefinitions,
  currentName?: string,
): boolean =>
  name === currentName ||
  !Object.prototype.hasOwnProperty.call(defs ?? {}, name);

export const createUniqueDefinitionName = (
  value: string,
  defs: WorkflowDefinitions,
  fallbackName = "definition",
): string => {
  const baseName = normalizeDefinitionName(value) || fallbackName;
  let candidate = baseName;
  let suffix = 2;

  while (!isDefinitionNameAvailable(candidate, defs)) {
    candidate = `${baseName}_${suffix}`;
    suffix += 1;
  }

  return candidate;
};
