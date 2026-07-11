import path from "node:path";

/**
 * Resolve a user-supplied path and prove it remains inside the approved root.
 * This is intentionally fail-closed: sibling prefixes, `..` traversal, and
 * absolute paths outside the root are rejected before any filesystem access.
 */
export function resolveInsideRoot(root: string, candidate: string): string {
  const resolved