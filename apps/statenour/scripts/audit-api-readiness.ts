/**
 * scripts/audit-api-readiness.ts
 *
 * v10.0.524 · API agent-readiness audit.
 *
 * Scans every app/api/**\/route.ts and scores it against
 * Postman's 8-pillar agent-readiness framework:
 *
 *   1. Discoverability    — clear, RESTful path naming
 *   2. Authentication     — explicit guard (apiHandler { auth }
 *                            or requireSession / requireCronAuth /
 *                            requireSyncAuth / assertRunnerRequest)
 *   3. Input validation   — zod (or equivalent) on body / params
 *   4. Error handling     — typed errors (ServiceError),
 *                            no PII / stack leaks
 *   5. Response shape     — consistent envelope via apiHandler
 *   6. Idempotency        — POST/PUT/PATCH marked or naturally so
 *                            (idempotency key, upsert pattern,
 *                            comment marker)
 *   7. Rate-limit         — { rateLimit } option declared
 *   8. AI-callability     — JSDoc block describes purpose +
 *                            machine-readable params
 *
 * Output: docs/audits/api-readiness-{YYYY-MM-DD}.md
 *
 * Run: `pnpm tsx scripts/audit-api-readiness.ts`
 *
 * NOTE · this is a static-analysis pass — it grep-greps for
 * the markers each pillar cares about. It will not catch every
 * dynamically-loaded validator or every runtime-only guard.
 * It's a directional signal, not a proof. Treat it like a lint
 * pass: high-score routes are likely fine, low-score routes
 * deserve a human eye.
 *
 * Threat-modeling-expert lens: pillar 4 explicitly flags PII
 * leak surfaces (we look for `error.stack` returned in a body,
 * raw `error` objects sent over the wire, and message strings
 * that look like SQL fragments). Pillar 2 flags the most
 * common silent-auth bypass (a mutating verb with no guard
 * pattern in the file at all).
 */

import fs from "node:fs";
import path from "node:path";

// ── Types ────────────────────────────────────────────────

interface RouteMeta {
  /** Absolute filesystem path. */
  file: string;
  /** Relative pretty path (app/api/...) for the report. */
  rel: string;
  /** URL-style route path inferred from the file path. */
  routePath: string;
  /** HTTP methods exported from the file. */
  methods: ReadonlyArray<HttpMethod>;
  /** Result of pillar-by-pillar scoring. */
  scores: PillarScores;
  /** Sum of pillar scores (0-80). */
  totalScore: number;
  /** Top-3 reasons this route lost points — ordered by impact. */
  topMisses: ReadonlyArray<string>;
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

const MUTATING_METHODS: ReadonlyArray<HttpMethod> = ["POST", "PUT", "PATCH", "DELETE"];

interface PillarScores {
  discoverability: PillarResult;
  authentication: PillarResult;
  inputValidation: PillarResult;
  errorHandling: PillarResult;
  responseShape: PillarResult;
  idempotency: PillarResult;
  rateLimit: PillarResult;
  aiCallability: PillarResult;
}

interface PillarResult {
  /** 0-10 score for the pillar. */
  score: number;
  /** Optional human-readable miss reason (only present when score < 10). */
  miss?: string;
}

const PILLAR_NAMES: ReadonlyArray<{ key: keyof PillarScores; label: string }> = [
  { key: "discoverability", label: "Discoverability" },
  { key: "authentication", label: "Authentication" },
  { key: "inputValidation", label: "Input validation" },
  { key: "errorHandling", label: "Error handling" },
  { key: "responseShape", label: "Response shape" },
  { key: "idempotency", label: "Idempotency" },
  { key: "rateLimit", label: "Rate-limit" },
  { key: "aiCallability", label: "AI-callability" },
];

const MAX_TOTAL = PILLAR_NAMES.length * 10; // 80

// ── Walker ───────────────────────────────────────────────

function walkRoutes(rootDir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name === "route.ts") {
        out.push(full);
      }
    }
  }
  return out.sort();
}

// ── Parsers ──────────────────────────────────────────────

function detectMethods(source: string): ReadonlyArray<HttpMethod> {
  const out: HttpMethod[] = [];
  const all: ReadonlyArray<HttpMethod> = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ];
  for (const m of all) {
    // Matches `export const POST` / `export async function POST` /
    // `export function POST` / `export const POST =` patterns.
    const re = new RegExp(
      `^export\\s+(?:async\\s+function|function|const|let|var)\\s+${m}\\b`,
      "m",
    );
    if (re.test(source)) out.push(m);
  }
  return out;
}

function routePathFromFile(absFile: string, rootDir: string): string {
  const rel = path
    .relative(rootDir, absFile)
    .replaceAll(path.sep, "/")
    .replace(/\/route\.ts$/, "");
  return `/${rel}`;
}

// ── Pillar scorers ───────────────────────────────────────

function scoreDiscoverability(routePath: string): PillarResult {
  // Penalize unclear paths: very deep nesting, all-uppercase
  // segments, segment names with ambiguous abbreviations.
  const segments = routePath.split("/").filter(Boolean);
  const dynamic = segments.filter((s) => s.startsWith("[")).length;
  const depth = segments.length;
  if (depth > 7) {
    return { score: 6, miss: `path nesting depth ${depth} > 7 reduces discoverability` };
  }
  // Bias against routes whose final segment is an opaque word
  // like "run" / "x" / "do" / "thing" without a noun.
  const last = segments[segments.length - 1] ?? "";
  const opaqueTokens = new Set(["x", "do", "thing", "stuff", "misc", "z"]);
  if (opaqueTokens.has(last)) {
    return { score: 4, miss: `final segment "${last}" is opaque (no clear noun)` };
  }
  // All-uppercase segment = likely accidental.
  if (segments.some((s) => /^[A-Z_]+$/.test(s))) {
    return { score: 6, miss: "all-uppercase segment present — typo or constant leaked into path?" };
  }
  // Dynamic-segment density: more than half the path being [params]
  // muddies the resource model.
  if (depth >= 3 && dynamic / depth > 0.5) {
    return { score: 7, miss: "more than half the segments are dynamic — resource model unclear" };
  }
  return { score: 10 };
}

function scoreAuthentication(
  source: string,
  methods: ReadonlyArray<HttpMethod>,
  routePath: string,
): PillarResult {
  // Mutating routes need an explicit guard pattern.
  const hasMutator = methods.some((m) => MUTATING_METHODS.includes(m));
  const hasApiHandlerAuth = /apiHandler\s*\([\s\S]*?\{\s*[\s\S]*?auth\s*:\s*"(owner|cron|sync)"/m.test(
    source,
  );
  const hasCronHandler = /\bcronHandler\s*\(/.test(source);
  const hasSyncHandler = /\bsyncHandler\s*\(/.test(source);
  const hasRequireSession = /\brequireSession\s*\(/.test(source);
  const hasRequireCron = /\brequireCronAuth\s*\(/.test(source);
  const hasRequireSync = /\brequireSyncAuth\s*\(/.test(source);
  const hasRunnerGuard = /\bassertRunnerRequest\s*\(/.test(source);
  const hasInlineSecret = /process\.env\.(CRON_SECRET|SYNC_KEY|WEBHOOK_SECRET|TELEGRAM_WEBHOOK_SECRET)\b/.test(
    source,
  );
  const hasPublicMarker = /^\s*\/\/\s*public:/m.test(source);

  const guarded =
    hasApiHandlerAuth ||
    hasCronHandler ||
    hasSyncHandler ||
    hasRequireSession ||
    hasRequireCron ||
    hasRequireSync ||
    hasRunnerGuard ||
    hasInlineSecret;

  if (hasMutator && !guarded) {
    return {
      score: 0,
      miss: "mutating verb with NO recognized auth guard — silent-bypass risk",
    };
  }
  if (!hasMutator && !guarded && !hasPublicMarker) {
    // Read-only with no guard and no "public:" marker — undeclared
    // public surface. Not a P0 but worth flagging.
    return { score: 6, miss: "read-only route has neither guard nor `// public:` declaration" };
  }
  // OAuth + Next-Auth catch-all routes use NextAuth's own guard, not
  // ours — treat them as auth-declared. Path-based recognition.
  if (routePath.startsWith("/auth") || routePath.startsWith("/oauth")) {
    return { score: 10 };
  }
  return { score: 10 };
}

function scoreInputValidation(
  source: string,
  methods: ReadonlyArray<HttpMethod>,
): PillarResult {
  const hasMutator = methods.some((m) => MUTATING_METHODS.includes(m));
  const hasZod = /\b(?:z\.|zod|\.parse\(|\.safeParse\(|safeParseBody|readRequestJson)\b/.test(
    source,
  );
  const hasSearchParamsParse = /searchParams\.get\(.+?\)\s*\?\?|parseInt\(/.test(source);
  if (hasMutator && !hasZod) {
    return {
      score: 2,
      miss: "mutating verb without zod / safeParseBody / readRequestJson body validation",
    };
  }
  if (!hasMutator && !hasZod && !hasSearchParamsParse) {
    // GET-only routes with no query-string parsing at all are fine —
    // they have no input.
    return { score: 10 };
  }
  if (!hasMutator && !hasZod && hasSearchParamsParse) {
    return { score: 7, miss: "query params parsed without zod (manual coercion)" };
  }
  return { score: 10 };
}

function scoreErrorHandling(source: string): PillarResult {
  const hasServiceError = /\bServiceError\b/.test(source);
  const usesApiHandler = /\bapiHandler\b/.test(source);
  const usesCronHandler = /\bcronHandler\b/.test(source);
  const usesSyncHandler = /\bsyncHandler\b/.test(source);
  const wrapped = usesApiHandler || usesCronHandler || usesSyncHandler;

  // PII / stack leak markers — body that returns raw error or stack.
  const leaksStack = /NextResponse\.json\(\s*\{[^}]*\b(?:stack|error)\s*:\s*[a-zA-Z_$][\w$]*\s*\.?\s*stack\b/.test(
    source,
  );
  const leaksRawError = /jsonError\([^)]*error\b[^)]*\)/.test(source) &&
    !/error instanceof|error\.message/.test(source);

  if (leaksStack) {
    return { score: 2, miss: "response body appears to include raw `error.stack` (PII / debug leak)" };
  }
  if (leaksRawError) {
    return { score: 4, miss: "raw error object passed to jsonError without sanitization" };
  }
  if (!wrapped) {
    return { score: 5, miss: "route is not wrapped by apiHandler/cronHandler/syncHandler (no central error catch)" };
  }
  if (!hasServiceError && /throw\s+new\s+Error\b/.test(source)) {
    return { score: 7, miss: "uses raw `throw new Error(...)` instead of typed ServiceError" };
  }
  return { score: 10 };
}

function scoreResponseShape(source: string): PillarResult {
  const usesApiHandler = /\bapiHandler\b/.test(source);
  const usesCronHandler = /\bcronHandler\b/.test(source);
  const usesSyncHandler = /\bsyncHandler\b/.test(source);
  const usesEnvelope = usesApiHandler || usesCronHandler || usesSyncHandler;
  // Raw NextResponse without envelope is a yellow flag (the envelope
  // is what makes responses agent-callable).
  const rawNextResponses = (source.match(/NextResponse\.json\(/g) ?? []).length;
  const hasReturn = /return\s+(?:NextResponse|new Response|Response\.json)/.test(source);
  if (!usesEnvelope && rawNextResponses > 0) {
    return { score: 4, miss: "returns raw NextResponse without apiHandler envelope (no { ok, data, meta })" };
  }
  if (!usesEnvelope && !hasReturn) {
    return { score: 6, miss: "no clear response shape detected" };
  }
  return { score: 10 };
}

function scoreIdempotency(
  source: string,
  methods: ReadonlyArray<HttpMethod>,
): PillarResult {
  const hasMutator = methods.some((m) => MUTATING_METHODS.includes(m));
  if (!hasMutator) return { score: 10 };
  // POST/PUT/PATCH: idempotent if upsert / set-state / Idempotency-Key
  // pattern visible.
  const hasUpsert = /\.upsert\s*\(/.test(source);
  const hasIdempotencyKey = /Idempotency-Key|idempotencyKey/i.test(source);
  const hasIdempotentComment = /idempotent|safe to retry/i.test(source);
  const isDelete = methods.includes("DELETE"); // DELETE is naturally idempotent
  if (isDelete || hasUpsert || hasIdempotencyKey || hasIdempotentComment) {
    return { score: 10 };
  }
  return {
    score: 5,
    miss: "mutating verb without upsert / Idempotency-Key / explicit idempotent marker",
  };
}

function scoreRateLimit(source: string, routePath: string): PillarResult {
  const hasRateLimitOption = /rateLimit\s*:\s*"(general|ai|auth|sync)"/.test(source);
  const isCron = routePath.startsWith("/cron");
  const isInternal = routePath.startsWith("/internal");
  // Cron + internal routes are guarded by secret, not rate. OK to skip.
  if (isCron || isInternal) return { score: 10 };
  if (hasRateLimitOption) return { score: 10 };
  return {
    score: 5,
    miss: "no { rateLimit: ... } declared (route relies on auth alone)",
  };
}

function scoreAiCallability(source: string, methods: ReadonlyArray<HttpMethod>): PillarResult {
  // AI / agent callability requires: clear docstring + at least one
  // exported method + machine-readable param hints (TypeScript
  // interface for body OR explicit query-param doc).
  const hasJsdoc = /\/\*\*[\s\S]*?\*\//.test(source);
  const docHasPurpose = hasJsdoc && /\*\s+\w+/.test(source.match(/\/\*\*[\s\S]*?\*\//)?.[0] ?? "");
  const hasInterface = /\binterface\s+\w+\s*\{/.test(source);
  const hasTypeAlias = /\btype\s+\w+\s*=\s*\{/.test(source);
  const machineReadable = hasInterface || hasTypeAlias;
  if (!hasJsdoc) {
    return { score: 3, miss: "no JSDoc block — agents cannot self-describe this route" };
  }
  if (!docHasPurpose) {
    return { score: 6, miss: "JSDoc present but does not describe purpose" };
  }
  const hasMutator = methods.some((m) => MUTATING_METHODS.includes(m));
  if (hasMutator && !machineReadable) {
    return { score: 6, miss: "mutating route without exported body interface — schema not agent-callable" };
  }
  return { score: 10 };
}

// ── Scoring + report ─────────────────────────────────────

function scoreRoute(file: string, apiRoot: string): RouteMeta | null {
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const methods = detectMethods(source);
  // Skip files that don't actually export any HTTP method — they're
  // typically helpers that ended up under /api by accident.
  if (methods.length === 0) return null;
  const routePath = routePathFromFile(file, apiRoot);
  const rel = path
    .relative(path.resolve(apiRoot, "../.."), file)
    .replaceAll(path.sep, "/");

  const scores: PillarScores = {
    discoverability: scoreDiscoverability(routePath),
    authentication: scoreAuthentication(source, methods, routePath),
    inputValidation: scoreInputValidation(source, methods),
    errorHandling: scoreErrorHandling(source),
    responseShape: scoreResponseShape(source),
    idempotency: scoreIdempotency(source, methods),
    rateLimit: scoreRateLimit(source, routePath),
    aiCallability: scoreAiCallability(source, methods),
  };

  const totalScore = PILLAR_NAMES.reduce((acc, p) => acc + scores[p.key].score, 0);

  // Top misses, sorted by deficit (10 - score) descending.
  const topMisses = PILLAR_NAMES.map((p) => ({
    label: p.label,
    deficit: 10 - scores[p.key].score,
    miss: scores[p.key].miss,
  }))
    .filter((m) => m.miss)
    .sort((a, b) => b.deficit - a.deficit)
    .slice(0, 3)
    .map((m) => `${m.label}: ${m.miss}`);

  return {
    file,
    rel,
    routePath,
    methods,
    scores,
    totalScore,
    topMisses,
  };
}

interface ReportSummary {
  totalRoutes: number;
  averageScore: number;
  perfectRoutes: number;
  zeroAuthMutators: number;
  topMissPillars: ReadonlyArray<{ pillar: string; avg: number }>;
}

function summarize(results: ReadonlyArray<RouteMeta>): ReportSummary {
  const totalRoutes = results.length;
  const sum = results.reduce((a, r) => a + r.totalScore, 0);
  const averageScore = totalRoutes > 0 ? sum / totalRoutes : 0;
  const perfectRoutes = results.filter((r) => r.totalScore === MAX_TOTAL).length;
  const zeroAuthMutators = results.filter(
    (r) =>
      r.scores.authentication.score === 0 &&
      r.methods.some((m) => MUTATING_METHODS.includes(m)),
  ).length;
  const topMissPillars = PILLAR_NAMES.map(({ key, label }) => ({
    pillar: label,
    avg: totalRoutes > 0
      ? results.reduce((a, r) => a + r.scores[key].score, 0) / totalRoutes
      : 0,
  }))
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 4);
  return { totalRoutes, averageScore, perfectRoutes, zeroAuthMutators, topMissPillars };
}

function formatReport(
  results: ReadonlyArray<RouteMeta>,
  summary: ReportSummary,
  date: string,
): string {
  const sortedAsc = [...results].sort((a, b) => a.totalScore - b.totalScore);
  const sortedDesc = [...results].sort((a, b) => b.totalScore - a.totalScore);

  // Top-10 fixes: routes with the largest deficit, ordered by deficit
  // descending. Tie-break by mutating-method presence (mutators
  // first) and then by alphabetic path for determinism.
  const topFixes = sortedAsc
    .filter((r) => r.totalScore < MAX_TOTAL)
    .sort((a, b) => {
      const deficit = a.totalScore - b.totalScore;
      if (deficit !== 0) return deficit;
      const aMut = a.methods.some((m) => MUTATING_METHODS.includes(m)) ? 0 : 1;
      const bMut = b.methods.some((m) => MUTATING_METHODS.includes(m)) ? 0 : 1;
      if (aMut !== bMut) return aMut - bMut;
      return a.routePath.localeCompare(b.routePath);
    })
    .slice(0, 10);

  const lines: string[] = [];
  lines.push(`# API Agent-Readiness Audit · ${date}`);
  lines.push("");
  lines.push(
    "_Generated by `pnpm tsx scripts/audit-api-readiness.ts`. " +
      "Static-analysis pass; treat as directional, not proof._",
  );
  lines.push("");
  lines.push("## Top-line");
  lines.push("");
  lines.push(
    `- **Routes scanned:** ${summary.totalRoutes}`,
  );
  lines.push(
    `- **Average score:** ${summary.averageScore.toFixed(1)} / ${MAX_TOTAL}` +
      ` (${((summary.averageScore / MAX_TOTAL) * 100).toFixed(1)}%)`,
  );
  lines.push(
    `- **Perfect-score routes (${MAX_TOTAL}/${MAX_TOTAL}):** ${summary.perfectRoutes}`,
  );
  lines.push(
    `- **Mutating routes with NO recognized auth guard:** ${summary.zeroAuthMutators}`,
  );
  lines.push("");
  lines.push("### Weakest pillars (lowest avg across the fleet)");
  lines.push("");
  lines.push("| Pillar | Avg score |");
  lines.push("|---|---|");
  for (const p of summary.topMissPillars) {
    lines.push(`| ${p.pillar} | ${p.avg.toFixed(1)} / 10 |`);
  }
  lines.push("");

  // ── Top 10 fixes ──
  lines.push("## Top 10 fixes — ranked by impact");
  lines.push("");
  if (topFixes.length === 0) {
    lines.push("_No routes below perfect score — every route ships agent-ready._");
  } else {
    lines.push("| # | Route | Methods | Score | Top miss |");
    lines.push("|---|---|---|---|---|");
    topFixes.forEach((r, i) => {
      const topMiss = r.topMisses[0] ?? "—";
      lines.push(
        `| ${i + 1} | \`${r.routePath}\` | ${r.methods.join(", ")} | ` +
          `${r.totalScore} / ${MAX_TOTAL} | ${topMiss} |`,
      );
    });
  }
  lines.push("");

  // ── Highest-scoring routes (for reference) ──
  const topPerfect = sortedDesc.slice(0, 5);
  lines.push("## Reference · 5 highest-scoring routes");
  lines.push("");
  lines.push("| Route | Methods | Score |");
  lines.push("|---|---|---|");
  for (const r of topPerfect) {
    lines.push(`| \`${r.routePath}\` | ${r.methods.join(", ")} | ${r.totalScore} / ${MAX_TOTAL} |`);
  }
  lines.push("");

  // ── Per-route breakdown (worst first) ──
  lines.push("## Per-route breakdown (worst → best)");
  lines.push("");
  lines.push("Each row = one route. Pillar columns are 0-10. Total max is " + MAX_TOTAL + ".");
  lines.push("");
  lines.push(
    "| Route | Methods | Disc | Auth | Inp | Err | Resp | Idem | Rate | AI | **Total** |",
  );
  lines.push(
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const r of sortedAsc) {
    const s = r.scores;
    lines.push(
      `| \`${r.routePath}\` | ${r.methods.join(", ")} ` +
        `| ${s.discoverability.score} ` +
        `| ${s.authentication.score} ` +
        `| ${s.inputValidation.score} ` +
        `| ${s.errorHandling.score} ` +
        `| ${s.responseShape.score} ` +
        `| ${s.idempotency.score} ` +
        `| ${s.rateLimit.score} ` +
        `| ${s.aiCallability.score} ` +
        `| **${r.totalScore}** |`,
    );
  }
  lines.push("");

  // ── Detail · top misses per route ──
  lines.push("## Detail · misses by route (only routes below perfect)");
  lines.push("");
  for (const r of sortedAsc) {
    if (r.totalScore === MAX_TOTAL) continue;
    lines.push(`### \`${r.routePath}\` — ${r.totalScore}/${MAX_TOTAL}`);
    lines.push("");
    lines.push(`- file: \`${r.rel}\``);
    lines.push(`- methods: ${r.methods.join(", ")}`);
    if (r.topMisses.length === 0) {
      lines.push("- misses: _(none flagged — soft deductions only)_");
    } else {
      for (const m of r.topMisses) {
        lines.push(`- ${m}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────

function main(): void {
  const repoRoot = path.resolve(__dirname, "..");
  const apiRoot = path.join(repoRoot, "app", "api");
  if (!fs.existsSync(apiRoot)) {
    console.error(`[audit-api-readiness] no app/api directory at ${apiRoot}`);
    process.exit(1);
  }

  const files = walkRoutes(apiRoot);
  console.log(`[audit-api-readiness] scanning ${files.length} route.ts files…`);

  const results: RouteMeta[] = [];
  for (const f of files) {
    const meta = scoreRoute(f, apiRoot);
    if (meta) results.push(meta);
  }

  const summary = summarize(results);

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const outDir = path.join(repoRoot, "docs", "audits");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `api-readiness-${date}.md`);
  const md = formatReport(results, summary, date);
  fs.writeFileSync(outPath, md, "utf8");

  console.log("");
  console.log(`[audit-api-readiness] wrote ${outPath}`);
  console.log(
    `[audit-api-readiness] top-line: ${summary.totalRoutes} routes · ` +
      `avg ${summary.averageScore.toFixed(1)}/${MAX_TOTAL} · ` +
      `${summary.perfectRoutes} perfect · ` +
      `${summary.zeroAuthMutators} zero-auth mutators`,
  );
  console.log("");
  // Exit code: 0 always. This is an audit, not a gate. If we ever
  // want to gate, condition on summary.zeroAuthMutators > 0.
}

main();
