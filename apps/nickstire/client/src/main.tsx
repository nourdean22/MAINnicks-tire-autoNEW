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
      /**
       * ONE retry, not query-core's default of three.
       *
       * The per-request ceiling below is armed INSIDE the fetch, so every retry
       * attempt gets a fresh timer. At the default 3 retries the worst case was
       * 4 x 120s plus backoff — about 8 minutes — and the spinner survived all of
       * it, because query-core's `failed` transition does not clear fetchStatus:
       * it stays "fetching", which every loading branch in this admin reads as
       * "still working". A per-attempt bound is not a bound on the SPINNER unless
       * the attempt count is bounded too.
       *
       * 1 retry was the first attempt at bounding it, but the ceiling then had to
       * rise to 300s to clear the server's own budgets (see REQUEST_CEILING_MS),
       * which put the worst case back near 600s — worse than the problem.
       *
       * 0 is the honest answer now that a failed read renders an explicit
       * "unavailable" state with a Retry control (client/src/lib/queryState.ts)
       * rather than an indefinite spinner. Polling queries still recover on their
       * own interval and every query still refetches on window focus, so the
       * operator gets an actionable error within ONE ceiling instead of a silent
       * wait of several.
       */
      retry: 0,
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
 * THE CEILING MUST EXCEED THE SERVER'S OWN BUDGET, and the first value (120s)
 * did not. `generateReelBrief` makes TWO sequential invokeLLM calls each
 * configured timeoutMs 120000 — a 240s server budget before any provider
 * failover — and `postInstagramReel` budgets ~15s of container creation plus
 * 30 x 5s of status polling (~165s) before it even calls media_publish. At 120s
 * this aborted work the server was still legitimately doing: the operator was
 * told "failed" for a reel that WENT LIVE, and paid twice for a brief that was
 * still generating. A ceiling below the server budget converts healthy slowness
 * into false failure on non-idempotent, money-spending calls — strictly worse
 * than the hang it replaced.
 *
 * 300s clears both measured budgets with headroom, and pairs with `retry: 0`
 * above so the bound is 300s TOTAL rather than a multiple of it. Re-measure the
 * longest legitimate server call before lowering either number.
 */
const REQUEST_CEILING_MS = 300_000;

/**
 * Bound a request without discarding tRPC's own cancellation signal.
 *
 * MANUAL COMPOSITION ON PURPOSE — do not "simplify" this to `AbortSignal.timeout`
 * plus `AbortSignal.any`. Review of the first version (PR #1601) caught two
 * defects in exactly that approach:
 *
 *  1. `AbortSignal.timeout` was called unconditionally. On an iOS/Safari build
 *     without it, EVERY tRPC call would throw synchronously here instead of
 *     issuing a request — breaking the whole admin far worse than the stalled
 *     spinner this exists to fix.
 *  2. Where `timeout` existed but `AbortSignal.any` did not, the fallback
 *     forwarded only the caller's signal and silently DROPPED the ceiling, so
 *     the fix quietly did nothing on those browsers.
 *
 * `AbortController` + `addEventListener` are available everywhere this PWA runs,
 * so composing by hand needs no feature detection and keeps BOTH guarantees:
 * tRPC's unmount cancellation still propagates, and the ceiling always applies.
 *
 * THE TIMER IS DELIBERATELY NOT CLEARED WHEN THE FETCH PROMISE SETTLES. An
 * earlier version did that via `.finally()`, which looked tidier and quietly
 * reopened the hole: `fetch` resolves at response HEADERS, while tRPC then reads
 * the body (`await res.json()`) with nothing watching it. Clearing on headers
 * therefore left a response that answers and then stalls mid-body completely
 * unbounded — the exact failure this is for. Because the same signal is attached
 * to the Response body stream, keeping the timer alive bounds the body read too.
 *
 * The cost is one pending timer per in-flight request for up to the ceiling, and
 * a late `abort()` on an already-settled controller, which is a documented no-op.
 * That is the right trade: a cheap idle timer against a class of hang the UI
 * renders as a permanent spinner.
 */
function boundedSignal(existing: AbortSignal | null | undefined): AbortSignal {
  const controller = new AbortController();
  setTimeout(
    () => controller.abort(new DOMException(`request exceeded ${REQUEST_CEILING_MS}ms`, "TimeoutError")),
    REQUEST_CEILING_MS,
  );

  if (existing) {
    // Already cancelled before we got here — mirror it immediately.
    if (existing.aborted) controller.abort(existing.reason);
    else existing.addEventListener("abort", () => controller.abort(existing.reason), { once: true });
  }
  return controller.signal;
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
 *
 * SCOPE, STATED HONESTLY. Insights' other five queries still share one batch, so
 * they still arrive TOGETHER — the slowest of the five gates the other four. That
 * is intended: all five are local table reads, and splitting them would trade one
 * request for five to save nothing. What was wrong was batching a model call with
 * them. So this fixes the LLM case specifically, not "every card renders
 * independently" — if one of the five is ever measured slow, it joins this set
 * rather than the batch being abandoned.
 */
const UNBATCHED_SLOW_PROCEDURES = new Set<string>([
  "instagramAdmin.getPerformanceReport",
]);

const httpOptions = {
  url: "/api/trpc",
  transformer: superjson,
  // `signal` is listed AFTER the spread on purpose: tRPC also supplies one, and
  // the composed signal must win rather than be overwritten by it.
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
