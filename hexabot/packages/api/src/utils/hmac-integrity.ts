/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createHmac } from 'node:crypto';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }

  return value;
};

export const computeIntegrity = (value: unknown, key: Buffer) =>
  createHmac('sha256', key)
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');

export const verifyIntegrity = <T extends { integrity?: string }>(
  value: T,
  key: Buffer,
): boolean => {
  const { integrity, ...content } = value;
  if (!integrity) {
    return false;
  }

  return integrity === computeIntegrity(content, key);
};
