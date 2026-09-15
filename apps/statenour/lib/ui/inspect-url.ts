/**
 * `?inspect=<kind>:<id>` · the URL contract for the universal inspector ·
 * 2026-09-15 (UI workbench slice 1).
 *
 * Why a query param and not a hash: hashes are already taken by scroll
 * anchors (`#bd-`, `#pin-`, `#task-`), Next's router does not observe them,
 * and a hash cannot be read on the server. A query param survives reload,
 * works with Back/Forward when the OPEN is a `push` and the CLOSE is a
 * `replace` (the page-tabs.tsx convention), can be emitted by chat tool
 * results, and composes with `?tab=` on the same page.
 *
 * Pure string functions. The React side (hooks/use-inspector.ts) owns the
 * router calls; the page-context bridge reads the same param so Nick knows
 * what is on screen.
 */

import { formatEntityRef, parseEntityRef, type EntityRef } from "@/lib/ui/entity-ref";

export const INSPECT_PARAM = "inspect";

type SearchInput = string | URLSearchParams | null | undefined;

function toParams(search: SearchInput): URLSearchParams {
  if (!search) return new URLSearchParams();
  if (typeof search === "string") {
    return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  }
  return new URLSearchParams(search.toString());
}

/** The inspected entity in a query string, or null when absent / malformed. */
export function readInspect(search: SearchInput): EntityRef | null {
  return parseEntityRef(toParams(search).get(INSPECT_PARAM));
}

/**
 * The query string (no leading `?`) with `inspect` set to `ref`, or removed
 * when `ref` is null. Every other param is preserved verbatim, so opening the
 * inspector on `/brain?tab=memory` keeps the tab. The kind and the colon stay
 * literal for readable links; only the id is percent-encoded.
 */
export function withInspect(search: SearchInput, ref: EntityRef | null): string {
  const params = toParams(search);
  params.delete(INSPECT_PARAM);
  const rest = params.toString();
  if (!ref) return rest;
  const inspect = `${INSPECT_PARAM}=${ref.kind}:${encodeURIComponent(ref.id)}`;
  return rest ? `${rest}&${inspect}` : inspect;
}

/** A full href for `pathname` with the inspector set to `ref` (or cleared). */
export function inspectHref(pathname: string, search: SearchInput, ref: EntityRef | null): string {
  const qs = withInspect(search, ref);
  return qs ? `${pathname}?${qs}` : pathname;
}

/** True when the query string currently inspects exactly `ref`. */
export function isInspecting(search: SearchInput, ref: EntityRef): boolean {
  const current = readInspect(search);
  return current !== null && formatEntityRef(current) === formatEntityRef(ref);
}
