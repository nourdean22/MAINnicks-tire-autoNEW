import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink, TRPCClientError } from "@trpc/client";
import { createRoot, hydrateRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

// 2026-05-05 audit follow-up · admin polling cost reduction.
// 57 polling queries across the admin sections were hammering the
// backend even when the tab was hidden in the background. With the
// browser tabs minimized the backend was still receiving ~1 query/sec
// from a single open admin session. Turning refetchIntervalInBackground
// off pauses ALL polling when the tab loses focus — server picks back
// up the moment focus returns. ~50% drop in idle backend cost.
//
// Also setting reasonable defaults for staleTime so back-to-back queries
// hit cache instead of the network. Individual queries can override via
// useQuery options if they genuinely need fresher data.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true, // refresh when admin tabs back in
      staleTime: 10_000,            // 10s — most data is acceptable that fresh
      gcTime: 5 * 60_000,           // keep cached data 5 min after unmount
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

/**
 * A ceiling on how long a request may hang before it becomes an ERROR.
 *
 * WHY THIS EXISTS. This fetch wrapper passed `init` through with no signal of
 * its own, so a request that never settled left react-query in
 * `isPending && isFetching` forever — and every admin surface renders a spinner
 * off that. The operator's report was Community showing "Loading feed..."
 * indefinitely, but the cause is here, in the transport, and therefore applied
 * to EVERY query in the admin. A stalled connection was indistinguishable from
 * work in progress, with no bound.
 *
 * 120s is deliberately a BACKSTOP, not an SLA. It has to clear the slowest
 * legitimate call — the LLM-backed generate/brief mutations run tens of seconds
 * — while still guaranteeing that "forever" is not a state the UI can reach.
 * Tighten per-procedure if a real SLA is ever wanted; do not tighten here.
 */
const REQUEST_CEILING_MS = 120_000;

/**
 * Bound a request without discarding tRPC's own cancellation signal.
 *
 * `AbortSignal.any` is not on every browser this PWA runs on (the operator is on
 * iOS), so fall back to forwarding only the caller's signal rather than
 * overwriting it — losing the ceiling degrades to today's behaviour, whereas
 * losing cancellation would leak requests on every unmount.
 */
function boundedSignal(existing: AbortSignal | null | undefined): AbortSignal | undefined {
  const timeout = AbortSignal.timeout(REQUEST_CEILING_MS);
  if (!existing) return timeout;
  const anyOf = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  return typeof anyOf === "function" ? anyOf([existing, timeout]) : existing;
}

/**
 * Procedures that must NOT share a batch.
 *
 * `httpBatchLink` puts every concurrent query into ONE HTTP request, so the
 * slowest procedure in the batch decides when EVERY other procedure's data
 * arrives. Insights was the visible casualty: it fires six queries, five of them
 * local table reads, and one — `getPerformanceReport` — makes an `invokeLLM`
 * call. All six landed in one request, so the whole page sat behind a spinner
 * waiting on a model, and the five fast cards could not render early even though
 * their data was ready on the server.
 *
 * Anything LLM-backed and read on page load belongs here. This is a latency
 * boundary, not a correctness one: batching is still the right default for the
 * dozens of quick admin reads.
 */
const UNBATCHED_SLOW_PROCEDURES = new Set<string>([
  "instagramAdmin.getPerformanceReport",
]);

const httpOptions = {
  url: "/api/trpc",
  transformer: superjson,
  fetch(input: URL | RequestInfo, init?: RequestInit) {
    return globalThis.fetch(input, {
      ...(init ?? {}),
      credentials: "include",
      signal: boundedSignal(init?.signal),
    });
  },
};

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => UNBATCHED_SLOW_PROCEDURES.has(op.path),
      // Its own request: it can take as long as it takes without holding
      // anything else hostage.
      true: httpLink(httpOptions),
      false: httpBatchLink(httpOptions),
    }),
  ],
});

// 2026-05-24 PSI CLS fix · the prerender-to-all-users change (commit
// 12a07432) cut mobile LCP 7.9s → 3.8s but introduced a 0.204 desktop
// CLS regression because `createRoot().render()` WIPES the prerendered
// DOM and rebuilds it. The flash-then-rebuild moves elements between
// frames → layout shift.
//
// hydrateRoot() tells React the DOM already has the rendered tree ·
// React adopts it and only attaches event handlers. No rebuild, no
// shift. Detection · we set `data-prerendered="true"` from the
// prerender middleware in the HTML root element. If present, hydrate.
// Otherwise (cold dev / unrendered routes) fall back to createRoot.
//
// Safety net · if hydration mismatches occur, React logs warnings to
// console but doesn't crash · it bails out and rebuilds the mismatched
// subtree. So the worst case is "back to where we started" (CLS regression
// but no functional break). The first prerendered hit is the highest-
// value gate · once hydrated, all subsequent SPA navigations behave the
// same as before.
const rootEl = document.getElementById("root")!;
const tree = (
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);

// Heuristic for "is this a prerendered page?" · the prerender pass
// renders the root with child content (the SkipToContent link, the
// PageLayout etc). A non-prerendered cold load has root completely
// empty. If root has children, hydrate. Otherwise, createRoot.
if (rootEl.childNodes.length > 0) {
  hydrateRoot(rootEl, tree);
} else {
  createRoot(rootEl).render(tree);
}

// Register PWA service worker
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });

  // Reload ONCE when a new service worker takes control.
  //
  // sw.js already calls skipWaiting() + clients.claim(), so a new worker
  // activates immediately — but an ALREADY-OPEN tab keeps running against the
  // page the old worker served. That tab is exactly the one at risk: it is
  // holding a shell from the previous build.
  //
  // The `vite:preloadError` self-heal below cannot cover this. It fires when a
  // lazy chunk 404s AFTER the app has mounted; if the shell itself is stale, no
  // app code ever runs and there is nothing to catch the failure (measured
  // 2026-08-01: rootChars=0, no console error, black screen).
  //
  // `refreshing` guards against a reload loop — controllerchange can fire again
  // during the reload itself.
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

// wave-181.56 · self-heal on stale lazy-chunk failures
//
// When a Vite hashed chunk fails to load (because the build was rolled
// over since the page was served and the old chunk hash 404s), Vite
// fires a `vite:preloadError` event. Default behaviour: the dynamic
// import rejects → React Suspense fallback fires the ErrorBoundary →
// customer sees "THIS PAGE RAN INTO AN ERROR".
//
// Self-heal: catch the event once per session, hard-reload the page so
// the browser fetches the current index.html (with current chunk
// hashes). Use sessionStorage to prevent infinite reload loops if
// the new build is genuinely broken.
//
// Reference: https://vite.dev/guide/build.html#load-error-handling
//
// Background: wave-181.54/.55 deleted 199 stale prerendered pages
// that referenced dead chunk hashes from a previous build. This
// listener prevents the same class of bug recurring on the next
// prerender drift — if it happens, the user reloads once
// automatically and gets the working version.
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    // wave-181.57 · self-audit: wrapped sessionStorage in try/catch.
    // Original code crashed in private/incognito mode or when storage
    // was full → listener never reached reload → safety net defeated.
    // Fallback: if storage is unavailable, still reload ONCE per page
    // load (use a window-level flag) so we don't infinite-loop.
    const reloadedKey = "vite-preload-error-reload";
    type WindowWithReloadGuard = Window & { __viteReloadAttempted__?: boolean };
    const w = window as WindowWithReloadGuard;
    let alreadyReloaded = false;
    try {
      alreadyReloaded = !!sessionStorage.getItem(reloadedKey);
    } catch {
      alreadyReloaded = w.__viteReloadAttempted__ === true;
    }
    if (alreadyReloaded) {
      console.error("[preloadError] Already reloaded once — likely a real bug, not stale-bundle. Letting ErrorBoundary handle.", event);
      return;
    }
    try {
      sessionStorage.setItem(reloadedKey, String(Date.now()));
    } catch {
      // Storage blocked (incognito) or full; fall back to a window flag
      // so an in-tab loop still gets caught even without persistence.
      w.__viteReloadAttempted__ = true;
    }
    event.preventDefault();
    console.warn("[preloadError] Stale lazy chunk detected. Hard-reloading once to fetch fresh manifest.");
    window.location.reload();
  });
}
