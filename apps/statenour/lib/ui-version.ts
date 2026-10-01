/**
 * UI generation switch · shared by the server layout and the client switch.
 *
 * Plain module ON PURPOSE (no "use client"): a constant exported from a client
 * component file is a client REFERENCE when a server component imports it, not
 * the string — the first version of app/layout.tsx did exactly that, and
 * `cookies().get(<reference>)` silently returned undefined, so `?ui=v1` never
 * stamped data-ui="v1" (found 2026-10-01 by curling with the cookie header).
 * Pinned by tests/lib/ui-version.test.ts and tests/repo/ui-v2-grammar.test.ts.
 */

export const UI_VERSION_COOKIE = "statenour_ui";

export type UiVersion = "v1" | "v2";

/**
 * Cookie wins when it names a version; otherwise the STATENOUR_UI env flips the
 * default. Anything else is the current generation.
 */
export function resolveUiVersion(cookieValue: string | undefined, envDefault: string | undefined): UiVersion {
  if (cookieValue === "v1" || cookieValue === "v2") return cookieValue;
  return envDefault === "v1" ? "v1" : "v2";
}
