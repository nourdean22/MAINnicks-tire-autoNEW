/**
 * Import-graph boundary rules for apps/statenour (docs/UPSTREAMS.md row
 * "dependency-cruiser", adopted 2026-08-27). Deliberately tiny: each rule is
 * backed by a written policy or a real incident, per the register's "start
 * with rules proven by past incidents, not a full ruleset".
 *
 * Run via pinned `pnpm dlx` from .github/workflows/adoption-gates.yml - the
 * tool is NOT a repo dependency on purpose (no lockfile churn, no installs
 * in junctioned worktrees). The canary fixtures under
 * config/adoption-gates/fixtures/bad/ must keep FAILING this config; the
 * workflow asserts that before trusting any green.
 */
module.exports = {
  forbidden: [
    {
      name: "no-deprecated-card",
      severity: "error",
      comment:
        "components/ui/card.tsx is @deprecated (GlassCard is canonical, apps/statenour/AGENTS.md section 2); " +
        "only the grandfathered structured-stats files under components/stats/ may import it",
      from: { pathNot: "^apps/statenour/components/stats/" },
      // Second alternative catches the raw "@/components/ui/card" specifier
      // if alias resolution ever breaks - the rule must not go blind with it.
      to: { path: "apps/statenour/components/ui/card(\\.tsx)?$|^@/components/ui/card$" },
    },
    {
      name: "no-reverse-layer-imports",
      severity: "error",
      comment:
        "features/ and lib/ must not import from app/ - the App Router layer is the top of the graph. " +
        "Measured clean on 2026-08-27; this rule keeps it that way",
      from: { path: "^apps/statenour/(features|lib)/" },
      to: { path: "^apps/statenour/app/|^@/app/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "node_modules|\\.next|/tests/|__tests__|\\.test\\." },
    // "@/" alias resolution - see the header of webpack.depcruise.cjs for
    // why it is a webpack-config shim and not tsConfig (TS18003 in fresh
    // CI checkouts) or an alias option (schema-rejected in v18).
    webpackConfig: { fileName: "config/adoption-gates/webpack.depcruise.cjs" },
  },
};
