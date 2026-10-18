/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import dts from "vite-plugin-dts";
import { defineConfig } from "vitest/config";

/** Adds the `.cjs` extension Node requires inside a `type: module` package. */
const emitCommonJsAlias = (outDir: string): Plugin => ({
  name: "hexabot-commonjs-alias",
  apply: "build",
  closeBundle() {
    copyFileSync(
      resolve(outDir, "hexabot-widget.umd.js"),
      resolve(outDir, "hexabot-widget.cjs"),
    );
  },
});
/** Makes the browser global both callable and usable as an export namespace. */
const exposeLegacyUmdDefault = (): Plugin => ({
  name: "hexabot-legacy-umd-default",
  apply: "build",
  generateBundle(options, bundle) {
    if (options.format !== "umd") return;

    for (const output of Object.values(bundle)) {
      if (output.type !== "chunk" || !output.isEntry) continue;

      output.code += `
;(function (root) {
  if (typeof module !== "undefined" && module.exports) return;
  var namespace = root.HexabotWidget;
  if (namespace && typeof namespace.default === "function") {
    root.HexabotWidget = Object.assign(namespace.default, namespace);
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
`;
    }
  },
});

export default defineConfig(({ mode }) => {
  return {
    // JSX compiles against the external React the host page provides. The
    // automatic runtime would instead bundle v19's `react/jsx-runtime`, whose
    // elements the React 18 UMD global cannot render (React error #31).
    plugins: [
      react({ jsxRuntime: "classic" }),
      dts({
        tsconfigPath: "./tsconfig.build.json",
        // Publish one self-contained entry declaration. Keeping source-shaped
        // relative imports here breaks strict NodeNext consumers because this
        // package is ESM and those specifiers have no `.js` extension.
        bundleTypes: true,
      }),
      exposeLegacyUmdDefault(),
      emitCommonJsAlias(resolve(__dirname, "dist")),
    ],
    oxc: {
      // Aliased names, not `React`: most files already import `React`
      // themselves, and a second binding of that name is a parse error.
      jsx: {
        runtime: "classic",
        pragma: "__jsxCreateElement",
        pragmaFrag: "__jsxFragment",
      },
      jsxInject: `import { createElement as __jsxCreateElement, Fragment as __jsxFragment } from "react"`,
    },
    server: {
      host: "0.0.0.0",
    },
    define: {
      "process.env":
        mode === "development" ? { "process.env": process.env } : {},
      // Vite leaves `process.env.NODE_ENV` in lib builds for the consumer's
      // bundler, but a `<script>` embed has no `process`. Production only:
      // vitest shares this config, and React's production build omits `act`.
      "process.env.NODE_ENV": JSON.stringify(
        mode === "production" ? "production" : "development",
      ),
    },
    build: {
      // Include the public embed page so `preview` and `serve` provide a UMD
      // smoke test alongside the library artifacts.
      copyPublicDir: true,
      lib: {
        entry: resolve(__dirname, "src/index.tsx"),
        name: "HexabotWidget",
        fileName: (format) => `hexabot-widget.${format}.js`,
        cssFileName: "style",
      },
      rolldownOptions: {
        // `react-dom/client` is a separate specifier and stays external too,
        // or v19's copy of it gets bundled next to the host's v18 renderer.
        external: ["react", "react-dom", "react-dom/client"],
        output: {
          // The UMD global is the module namespace, so `config` and
          // `ChatWidget` both hang off it. `"default"` would assign the
          // default export straight to the global, but it only accepts an
          // entry that exports nothing else, which drops the named ESM API.
          exports: "named",
          globals: {
            react: "React",
            "react-dom": "ReactDOM",
            // The v18 UMD bundle puts `createRoot` on the one `ReactDOM`
            // global; there is no separate global for the `/client` entry.
            "react-dom/client": "ReactDOM",
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      setupFiles: "./src/test/setup.ts",
    },
  };
});
