import { unstable_isUnrecognizedActionError } from "next/navigation";

/**
 * Deploy skew · Q-35 (Sentry JAVASCRIPT-REACT-Z, "Failed to find Server
 * Action", 13 events on POST /auth/sign-in).
 *
 * Railway replaces the whole image on deploy, so a tab opened on the previous
 * build holds Server Action ids and chunk URLs the new server no longer has.
 * next.config.ts `deploymentId` makes Next hard-navigate on a skewed RSC
 * navigation; this module covers what reaches the root error boundary instead:
 * a skewed fetch action (Next throws UnrecognizedActionError on the client) or
 * a chunk that 404s. One reload fetches the current build and the user carries
 * on. A second skew error inside the window is NOT swallowed: the boundary
 * reports it, because a reload loop is a real bug.
 */

export const SKEW_RELOAD_KEY = "nour:skew-reload-at";
export const SKEW_RELOAD_WINDOW_MS = 60_000;

const SKEW_MESSAGE =
  /Failed to find Server Action|Server Action ".*" was not found on the server|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/;

export function isDeploySkewError(error: unknown): boolean {
  if (unstable_isUnrecognizedActionError(error)) return true;
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || SKEW_MESSAGE.test(error.message);
}

type SkewStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Reload once when `error` is deploy skew. Returns true when it reloaded, so
 * the caller skips reporting; false for any other error, or for a repeat
 * inside the window (the caller then reports it as usual).
 */
export function reloadOnceForDeploySkew(
  error: unknown,
  storage: SkewStorage | undefined,
  reload: () => void,
  now: number = Date.now(),
): boolean {
  if (!isDeploySkewError(error) || !storage) return false;
  try {
    const last = Number(storage.getItem(SKEW_RELOAD_KEY) ?? 0);
    if (now - last < SKEW_RELOAD_WINDOW_MS) return false;
    storage.setItem(SKEW_RELOAD_KEY, String(now));
  } catch {
    // Storage blocked (private mode): without a marker a reload could loop,
    // so report instead.
    return false;
  }
  reload();
  return true;
}
