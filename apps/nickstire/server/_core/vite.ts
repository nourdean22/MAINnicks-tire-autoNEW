import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

import { createLogger } from "../lib/logger";
import {
  createSpaFallbackHandler,
  injectNotFoundMeta,
  injectRouteMeta,
  pathnameOf,
  queryStringOf,
  resolvePublicPath,
} from "./spaFallback";

const log = createLogger("_core:vite");

function getPackageRoot(): string {
  let current = import.meta.dirname;
  while (current) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return import.meta.dirname;
}

// injectRouteMeta lives in ./spaFallback next to the status resolver it now
// pairs with, so both the production and the Vite dev catch-all read one truth.

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        getPackageRoot(),
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      // Same status decision as production so a soft 404 cannot hide in dev.
      // NOT req.path — inside app.use("*") it is always "/" (see pathnameOf).
      const resolution = resolvePublicPath(pathnameOf(req));
      if (resolution.kind === "redirect") {
        res.redirect(resolution.status, `${resolution.location}${queryStringOf(req)}`);
        return;
      }
      const finalPage =
        resolution.kind === "not_found" ? injectNotFoundMeta(page) : injectRouteMeta(page, url);
      res.status(resolution.status).set({ "Content-Type": "text/html" }).end(finalPage);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const packageRoot = getPackageRoot();
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(packageRoot, "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    log.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  // 2026-05-24 · diagnostic + defensive guard. The 12a07432→ca592fe5
  // PSI/middleware churn surfaced that /assets/*.css and /assets/*.js
  // were falling through to the catch-all and getting served as
  // text/html · browsers reject CSS at text/html. Two surgical adds:
  //   1) log how many files are actually in distPath/assets at boot ·
  //      tells us at startup whether the build output is where the
  //      server expects (vs missing/empty).
  //   2) below in the catch-all, return 404 for /assets/* + extension
  //      paths instead of HTML · stops the wrong-MIME silent failure.
  const assetsDir = path.join(distPath, "assets");
  if (fs.existsSync(assetsDir)) {
    try {
      const files = fs.readdirSync(assetsDir);
      const cssCount = files.filter((f) => f.endsWith(".css")).length;
      const jsCount = files.filter((f) => f.endsWith(".js")).length;
      log.info(
        `[serveStatic] ${assetsDir} · ${files.length} files (${cssCount} css · ${jsCount} js)`
      );
    } catch (e) {
      log.warn(`[serveStatic] failed to list ${assetsDir}:`, e);
    }
  } else {
    log.error(
      `[serveStatic] assets dir MISSING · ${assetsDir} · client build did not emit hashed bundles here · check vite outDir`
    );
  }

  // Hashed assets (JS/CSS) get 1-year immutable cache.
  app.use("/assets", express.static(path.join(distPath, "assets"), { maxAge: "1y", immutable: true }));

  // Other static files — extension-aware caching for Lighthouse "efficient
  // cache lifetimes" audit (was flagging 610 KiB of unhashed static).
  // - .webp/.png/.jpg/.svg/.ico → 1 year (these change rarely; we update the
  //   filename when content changes, not the cache header)
  // - .woff2/.woff/.ttf → 1 year (fonts are stable)
  // - .json (manifest, robots.txt, etc.) → 1 hour
  // - everything else → 1 day
  //
  // `index: false` — 2026-09-07. With the default, a request for "/" was
  // answered here by index.html as a plain file under that 1-day max-age
  // (measured live: `Cache-Control: public, max-age=86400` on the home page
  // for every non-bot visitor), so a deploy could take a day to reach a
  // returning customer's browser — the exact stale-HTML failure the 2026-05-06
  // cache fix in the catch-all below already solved for every OTHER route.
  // Routing "/" through the catch-all gives the home page the same 5-minute
  // must-revalidate header and the same registry meta injection as the rest.
  app.use(express.static(distPath, {
    index: false,
    maxAge: "1d",
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (/\.(webp|png|jpg|jpeg|svg|ico|gif|avif)$/.test(ext)) {
        // Long-lived images: 1 year + immutable. Filename-based cache busting
        // when we genuinely change a photo (rename or hash-suffix it).
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (/\.(woff2|woff|ttf|otf|eot)$/.test(ext)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (/\.json$/.test(ext)) {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
      // Default 1-day from express.static maxAge applies otherwise.
    },
  }));

  // fall through to index.html if the file doesn't exist — inject route-specific meta tags for SEO
  const indexPath = path.resolve(distPath, "index.html");
  const spaFallback = createSpaFallbackHandler({
    readIndexHtml: () => fs.readFileSync(indexPath, "utf-8"),
  });
  app.use("*", (req, res) => {
    // 2026-05-24 · defensive · never serve index.html for an asset
    // request that fell through · pre-fix any /assets/*.css or
    // *.js that wasn't on disk would get the SPA HTML back with
    // Content-Type: text/html · browsers refuse to apply that as
    // CSS/JS and the page renders unstyled. 404 + text/plain is
    // the honest failure mode · CSP also gets a cleaner console.
    const p = req.originalUrl;
    const isAssetPath =
      p.startsWith("/assets/") ||
      /\.(css|js|mjs|map|woff2?|ttf|otf|eot|svg|png|jpg|jpeg|gif|webp|avif|ico|json|xml|txt|wasm)(\?|$)/i.test(p);
    if (isAssetPath) {
      res
        .status(404)
        .set({
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        })
        .end(`Not Found: ${p}`);
      return;
    }

    // 2026-09-07 · honest status codes. An unknown path used to get the home
    // shell with a 200 (a soft 404 — see spaFallback.ts); a case-variant of a
    // real path used to render as a second copy of it. The decision, the meta
    // injection and the cache header live in one handler that is exercised
    // over real HTTP in spaFallback.test.ts — a wildcard mount rewrites
    // req.path to "/", which a pure-function test cannot catch.
    spaFallback(req, res);
  });
}
