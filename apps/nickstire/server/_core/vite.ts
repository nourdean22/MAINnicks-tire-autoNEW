import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { getRouteByPath } from "../../shared/routes";
import { SITE_URL } from "../../shared/business";

import { createLogger } from "../lib/logger";

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
/**
 * Inject route-specific meta tags (title, description, canonical, OG) into the HTML template.
 * This is critical for SEO — without it, Google sees the same homepage meta tags on every page,
 * causing soft 404s and duplicate content issues across the entire site.
 */
function injectRouteMeta(html: string, url: string): string {
  const path = url.split("?")[0];
  const route = getRouteByPath(path);

  // Critical SEO fix: if the path isn't in the route registry (e.g. dynamic
  // /blog/:slug, /:city neighborhood pages), DON'T return early — at minimum
  // we MUST overwrite the canonical to point to the requested URL. Otherwise
  // every dynamic page inherits index.html's canonical (`https://nickstire.org/`),
  // which Google interprets as "this is a duplicate of the homepage" and drops
  // the URL from the index. That bug killed indexing for 21 of 24 blog posts.
  if (!route) {
    const baseUrl = SITE_URL;
    const fullUrl = `${baseUrl}${path === "/" ? "/" : path}`;
    html = html.replace(
      /<link rel="canonical" href="[^"]*" \/>/,
      `<link rel="canonical" href="${fullUrl}" />`
    );
    html = html.replace(
      /<meta property="og:url" content="[^"]*" \/>/,
      `<meta property="og:url" content="${fullUrl}" />`
    );
    return html;
  }

  const baseUrl = SITE_URL;
  const fullUrl = `${baseUrl}${route.path}`;
  const escapedTitle = route.title.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const escapedDesc = route.description.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  // Replace title tag
  html = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapedTitle}</title>`
  );

  // Replace meta description
  html = html.replace(
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${escapedDesc}" />`
  );

  // Replace canonical URL
  html = html.replace(
    /<link rel="canonical" href="[^"]*" \/>/,
    `<link rel="canonical" href="${fullUrl}" />`
  );

  // Replace OG tags
  html = html.replace(
    /<meta property="og:url" content="[^"]*" \/>/,
    `<meta property="og:url" content="${fullUrl}" />`
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*" \/>/,
    `<meta property="og:title" content="${escapedTitle}" />`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*" \/>/,
    `<meta property="og:description" content="${escapedDesc}" />`
  );

  // Replace Twitter tags
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*" \/>/,
    `<meta name="twitter:title" content="${escapedTitle}" />`
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*" \/>/,
    `<meta name="twitter:description" content="${escapedDesc}" />`
  );

  return html;
}

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
      const finalPage = injectRouteMeta(page, url);
      res.status(200).set({ "Content-Type": "text/html" }).end(finalPage);
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
  app.use(express.static(distPath, {
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

    const indexPath = path.resolve(distPath, "index.html");
    let html = fs.readFileSync(indexPath, "utf-8");
    html = injectRouteMeta(html, req.originalUrl);
    // 2026-05-06 cache fix · was implicitly inheriting express.static's
    // 1-day default, meaning new HTML deploys took up to 24h to
    // propagate to returning visitors. HTML should be short-lived;
    // it points at hashed asset filenames that ARE long-cached.
    // 5-min browser + 5-min CDN with must-revalidate = deploy lands
    // for everyone within 5 minutes max.
    res
      .status(200)
      .set({
        "Content-Type": "text/html",
        "Cache-Control": "public, max-age=300, s-maxage=300, must-revalidate",
      })
      .end(html);
  });
}
