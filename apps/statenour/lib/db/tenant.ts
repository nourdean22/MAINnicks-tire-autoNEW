/**
 * Multi-tenant tenantId helper · v8.5 · BATCH 30 · Apr 29.
 *
 * Application-layer skeleton for multi-tenant operation. Composed
 * on the v7.8 actor (AsyncLocalStorage) primitive — instead of
 * threading `tenantId` through every signature, it lives in async
 * context and Prisma `data`/`where` builders read it implicitly.
 *
 * Why this exists as a skeleton:
 *   · NOUR OS is single-tenant TODAY (Nour). The roadmap I1 item is
 *     "if NOUR OS ever opens to others, multi-tenant RLS."
 *   · Adding a `tenantId` column to 80+ models is a destructive
 *     all-at-once migration. We ship the helper FIRST so all
 *     application code routes through it consistently, then the
 *     schema migration (separate batch) can land cleanly.
 *   · Until that migration ships, `currentTenantId()` returns the
 *     default `"single"` value — every query effectively no-ops.
 *
 * Public API:
 *   · TenantId — branded type. Exactly one value today: "single".
 *     Future-multi-tenant tightens this without a code rewrite.
 *   · withTenant(tenantId, fn) — async context wrapper.
 *   · currentTenantId() — read active tenant (defaults "single").
 *   · tenantScope() — spread into prisma where: { ...tenantScope() }
 *     to filter; today returns {} so no real filtering happens.
 *   · tenantStamp() — spread into prisma data: today returns {}.
 *
 * After the schema migration:
 *   · `tenantStamp()` will return `{ tenantId: currentTenantId() }`
 *   · `tenantScope()` will return `{ tenantId: currentTenantId() }`
 *   · No call site needs to change — the helpers are stable.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Branded tenant id. Single-tenant today (Nour); multi-tenant
 * pre-wired so every query / write that adopts these helpers will
 * be tenant-isolated the moment the schema migration lands.
 */
export type TenantId = string & { readonly __tenant: true };

const SINGLE_TENANT = "single" as TenantId;

const tenantStore = new AsyncLocalStorage<TenantId>();

/**
 * Run an async function with an explicit tenant in scope. Used at
 * the request boundary (apiHandler) once multi-tenant is enabled.
 */
export function withTenant<T>(
  tenantId: TenantId | string,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return tenantStore.run((tenantId as TenantId) ?? SINGLE_TENANT, fn);
}

/**
 * Read the active tenant. Falls back to "single" (the only valid
 * tenant pre-migration). Pre-migration callers can adopt these
 * helpers without behavioral change.
 */
export function currentTenantId(): TenantId {
  return tenantStore.getStore() ?? SINGLE_TENANT;
}

/**
 * Spread into a prisma `where` clause to filter to the current
 * tenant.
 *
 *   const rows = await prisma.task.findMany({
 *     where: { ...tenantScope(), status: "INBOX" }
 *   });
 *
 * TODAY (single-tenant): returns `{}`. After the schema migration,
 * returns `{ tenantId: "<active>" }` automatically.
 */
export function tenantScope(): Record<string, never> {
  // Pre-migration: empty object so existing queries are unchanged.
  // Post-migration: change to `{ tenantId: currentTenantId() }`.
  return {};
}

/**
 * Spread into a prisma `data` clause to stamp the tenant on a new
 * row.
 *
 *   await prisma.task.create({
 *     data: { ...payload, ...tenantStamp() }
 *   });
 */
export function tenantStamp(): Record<string, never> {
  // Pre-migration: no-op. Post-migration: returns the field.
  return {};
}

/**
 * Future-flag — flips to true once the migration lands. Helpers
 * branch on this so the same call sites Just Work across the cutover.
 *
 * To enable: change to `true` AFTER the schema migration applies
 * `tenantId` to every model. The helpers above light up automatically.
 */
export const MULTI_TENANT_ENABLED = false;

/**
 * Validate that an externally-supplied tenant id is one of the
 * known values. Skeleton has only "single"; expand the list when
 * onboarding starts.
 */
export function isKnownTenant(id: string): id is TenantId {
  return id === SINGLE_TENANT;
}
