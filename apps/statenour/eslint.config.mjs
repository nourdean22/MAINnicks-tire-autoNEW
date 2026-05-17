import nextVitals from "eslint-config-next/core-web-vitals";

/**
 * ESLint flat-config.
 *
 * Flat-config gotcha: a rule referenced via plugin prefix (e.g.
 * `@typescript-eslint/no-explicit-any`) must be declared in the SAME
 * config object that registers the plugin. The `...nextVitals` spread
 * registers `@typescript-eslint` via `typescript-eslint` (the unified
 * package), but that registration only applies inside nextVitals' own
 * config blocks. To add our own rule overrides we either (a) repeat the
 * plugin declaration, or (b) target a specific file pattern with its
 * own plugins block. We do (a) because our overrides apply repo-wide.
 */
const config = [
  ...nextVitals,
  // TS/TSX-scoped overrides. nextVitals already registers the
  // @typescript-eslint plugin for this glob; adding a rule here
  // resolves correctly without redeclaring the plugin.
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Type-safety enforcement — keep at `warn` during the strict
      // migration (W7). Flip to `error` once the count is < 20 so
      // any regression burns the build.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Hooks + general overrides (apply to all files nextVitals lints).
  {
    rules: {
      // ── React 19 + eslint-plugin-react-hooks v5 tightening ──────
      // These rules flag patterns that work correctly today but are
      // not React-Compiler-friendly. Warn-only during the gradual
      // refactor. Critical correctness rules (exhaustive-deps,
      // rules-of-hooks) stay at default error level.
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/immutability": "warn",

      // Apostrophes in copy aren't a real issue.
      "react/no-unescaped-entities": "warn",
    },
  },
  // Global ignores — never lint generated output or third-party.
  // (.next-ci and .next-test are Next's CI/test build artifacts —
  // huge minified chunks that crash ESLint with heap OOM if linted.)
  {
    ignores: [
      ".next/**",
      ".next-prod/**",
      ".next-ci/**",
      ".next-test/**",
      "node_modules/**",
      "dist/**",
      "docs/archive/**",
      "local-agent/**",
      ".vercel/**",
      "coverage/**",
      "prisma/migrations/**",
    ],
  },
];

export default config;
