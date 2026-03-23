import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { getRouteByPath } from "../../shared/routes";

/**
 * Inject route-specific meta tags (title, description, canonical, OG) into the HTML template.
 * This is critical for SEO — without it, Google sees the same homepage meta tags on every page,
 * causing soft 404s and duplicate content issues across the entire site.
 */
function injectRouteMeta(html: string, url: string): string {
  const route = getRouteByPath(url.split("?")[0]);
  if (!route) return html;

  const baseUrl = "https://nickstire.org";
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
        import.meta.dirname,
        "../..",
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
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist — inject route-specific meta tags for SEO
  app.use("*", (req, res) => {
    const indexPath = path.resolve(distPath, "index.html");
    let html = fs.readFileSync(indexPath, "utf-8");
    html = injectRouteMeta(html, req.originalUrl);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  });
}
