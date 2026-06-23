import nextVitals from "eslint-config-next/core-web-vitals";

/**
 * ESLint flat-config overrides.
 *
 * In ESLint Flat Config, a rule prefix (e.g. `react-hooks/...` or `@typescript-eslint/...`) 
 * must be validated against plugins declared in the *same* config object.
 * To avoid scope issues and duplicate imports, we dynamically map nextVitals' configs
 * and inject our rule overrides directly into objects that define rules/plugins.
 */
const config = [
  ...nextVitals.map((cfg) => {
    if (cfg.rules) {
      const newRules = { ...cfg.rules };
      const hasPlugin = (name) => cfg.plugins && name in cfg.plugins;

      if (hasPlugin("@typescript-eslint") || hasPlugin("typescript-eslint")) {
        newRules["@typescript-eslint/no-explicit-any"] = "warn";
      }

      if (hasPlugin("react-hooks")) {
        newRules["react-hooks/purity"] = "warn";
        newRules["react-hooks/set-state-in-effect"] = "warn";
        newRules["react-hooks/refs"] = "warn";
        newRules["react-hooks/static-components"] = "warn";
        newRules["react-hooks/immutability"] = "warn";
      }

      if (hasPlugin("react")) {
        newRules["react/no-unescaped-entities"] = "warn";
      }

      return {
        ...cfg,
        rules: newRules,
      };
    }
    return cfg;
  }),
  // Global ignores — never lint generated output or third-party
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
