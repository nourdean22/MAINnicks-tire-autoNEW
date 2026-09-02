/**
 * lib/services/integration-view.ts
 *
 * The client-safe projection of an Integration row.
 *
 * EXTRACTED from app/api/integrations/route.ts on 2026-09-02, in a self-audit
 * of that same day's C-1 fix. Three things were wrong with the first pass:
 *
 * 1 · It fixed GET and left POST returning `prisma.integration.create(...)`
 *     verbatim — so creating an integration echoed the `config` you had just
 *     posted, secrets included. Half the verb surface, half the fix.
 * 2 · Its comment said "scoping the select removes an exposure" while the
 *     select still carried `config: true`. What removed the exposure was the
 *     `.map()` afterwards. A comment that describes a mechanism the code does
 *     not implement is the exact defect class the audit exists to find, and
 *     writing one into the fix for it is worse than not commenting at all.
 * 3 · It silently dropped `metadata` from the response shape.
 *
 * WHY `config` IS STILL SELECTED. The one useful thing a client can learn
 * without seeing a secret is WHICH keys are stored — "is a refresh token
 * present?" is a real operator question. Deriving that requires reading the
 * column. So it is read, converted to key names, and dropped before the
 * response is built; it never crosses the HTTP boundary. That is a weaker
 * guarantee than never reading it, and saying so plainly is the point:
 * anything that logs a raw Prisma result inside this process would still see
 * it. `toIntegrationView()` is the only sanctioned way out.
 *
 * `metadata` gets the same treatment rather than being passed through. It is
 * a free-form operator-writable blob today with no reader; treating it as
 * potentially secret-bearing costs nothing and stops it becoming the next
 * `config`.
 */

/** Columns safe to read for the view. `config`/`metadata` are reduced to key names. */
export const INTEGRATION_VIEW_SELECT = {
  id: true,
  name: true,
  type: true,
  enabled: true,
  status: true,
  lastSyncAt: true,
  nextSyncAt: true,
  healthCheckUrl: true,
  errorCount: true,
  consecutiveFailures: true,
  createdAt: true,
  updatedAt: true,
  config: true,
  metadata: true,
} as const;

/** Key names present in a JSON blob. Never values, never nested keys. */
export function jsonKeyNames(blob: unknown): string[] {
  if (!blob || typeof blob !== "object" || Array.isArray(blob)) return [];
  return Object.keys(blob as Record<string, unknown>).sort();
}

export interface IntegrationView {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: string;
  lastSyncAt: Date | null;
  nextSyncAt: Date | null;
  healthCheckUrl: string | null;
  errorCount: number;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
  hasConfig: boolean;
  configKeys: string[];
  hasMetadata: boolean;
  metadataKeys: string[];
}

/**
 * Reduce a row to the client-safe view. Accepts a loose shape so both the
 * list read and the create result can pass through the same function — the
 * point of extracting it is that there is exactly ONE way out.
 */
export function toIntegrationView(row: Record<string, unknown>): IntegrationView {
  const { config, metadata, ...rest } = row;
  return {
    ...(rest as Omit<IntegrationView, "hasConfig" | "configKeys" | "hasMetadata" | "metadataKeys">),
    hasConfig: Boolean(config),
    configKeys: jsonKeyNames(config),
    hasMetadata: Boolean(metadata),
    metadataKeys: jsonKeyNames(metadata),
  };
}
