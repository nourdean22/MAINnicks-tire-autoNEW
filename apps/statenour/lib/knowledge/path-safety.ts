import path from "node:path";

/**
 * Resolve a user-supplied path and prove it remains inside the approved root.
 * Sibling-prefix tricks, `..` traversal, and absolute paths outside the root
 * are rejected before any filesystem access.
 */
export function resolveInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolvedCandidate;
  }

  throw new Error(`Path escapes approved root: ${candidate}`);
}
