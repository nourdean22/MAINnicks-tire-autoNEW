import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * scripts/lint-curdate.mjs — no NEW calendar date computed from the UTC DB clock
 * in server SQL (CURDATE() and its spellings; see the gate's header).
 *
 * Positive control first. Each arm is tagged:
 *   FAILS-ON-OLD — red against the gate this replaced (the regex comment
 *                  stripper, 2026-09-23), for the reason in its name;
 *   PINS         — green there too, but red under the named mutation of THIS gate.
 * CURDATE_GATE=<path to a copy> runs the spawned arms against that copy, which is
 * how both were checked. A gate that has never failed is a silent instrument, and
 * one that fails on a clean tree is switched off within a week.
 */
const APP = process.cwd();
const GATE = process.env.CURDATE_GATE ?? join(APP, "scripts/lint-curdate.mjs");
const RULE = "a calendar date computed from the UTC DB clock";
// The library switch must never reach a spawned gate: there it would turn the gate into a no-op.
const { CURDATE_GATE_AS_LIBRARY: _library, ...childEnv } = process.env;
const run = (args: string[] = []) =>
  spawnSync(process.execPath, [GATE, ...args], { cwd: APP, encoding: "utf-8", env: childEnv });

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

type Entry = { file?: unknown; count?: unknown; effect?: unknown; reason?: unknown };

/** A throwaway app root: server files + a baseline, so the real tree is never mutated. */
function fixture(files: Record<string, string>, entries: Entry[] = [], { defaults = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "curdate-"));
  dirs.push(dir);
  for (const [rel, src] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), src);
  }
  const bl = join(dir, "baseline.json");
  const list = defaults ? entries.map((e) => ({ effect: "rolling-window", reason: "fixture", ...e })) : entries;
  writeFileSync(bl, JSON.stringify({ entries: list }));
  return { dir, bl, args: ["--root", dir, "--baseline-file", bl] };
}

/**
 * What the gate counts in ONE file: the summary count (both gate generations print
 * "N site(s) in"), the exact lines via --list, and stderr (lexer failures surface there).
 */
function sitesIn(lines: string[], file = "server/x.ts") {
  const { args } = fixture({ [file]: lines.join("\n") + "\n" });
  const gate = run(args);
  const listed = run([...args, "--list"]);
  return {
    count: Number(/(\d+) site\(s\) in/.exec(gate.stdout)?.[1]),
    lines: listed.stdout
      .split("\n")
      .filter((l) => l.startsWith(`${file}:`))
      .map((l) => Number(l.slice(file.length + 1).split(" ")[0])),
    stderr: gate.stderr + listed.stderr,
  };
}

/** Assert the exact sites, in order of the assertion that fails first against the old gate. */
function expectSites(r: ReturnType<typeof sitesIn>, lines: number[]) {
  expect(r.count, "site count").toBe(lines.length);
  expect(r.stderr, "the lexer must not lose track of this valid source").not.toMatch(/lexer lost track/);
  expect(r.lines, "site lines").toEqual(lines);
}

const SITE = "const q = sql`SELECT 1 FROM invoices WHERE invoiceDate >= CURDATE()`;";

describe("lint-curdate · the ratchet", () => {
  it("POSITIVE CONTROL: a planted CURDATE() in a file with no baseline FAILS, names the rule, the line and both fixes", () => {
    const r = run(fixture({ "server/services/x.ts": `${SITE}\n` }).args);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(RULE);
    expect(r.stderr).toMatch(/server\/services\/x\.ts\s+0 → 1/);
    expect(r.stderr).toMatch(/L1\s+CURDATE\(\)/);
    expect(r.stderr).toMatch(/getBusinessDateKey\(\) from server\/lib\/timezoneAssert\.ts/);
    expect(r.stderr).toContain("DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))");
  });

  it("one more site than the file's baseline FAILS", () => {
    const r = run(fixture({ "server/a.ts": `${SITE}\n${SITE}\n` }, [{ file: "server/a.ts", count: 1 }]).args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/a\.ts\s+1 → 2/);
  });

  it("a baselined site passes; comments, tests and CONVERT_TZ are not counted", () => {
    const r = run(
      fixture(
        {
          "server/a.ts":
            `${SITE}\n// the old code used CURDATE() here\n/* CURDATE() in a block comment */\n` +
            "const ok = sql`DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))`;\n",
          "server/a.test.ts": `${SITE}\n`,
          "server/__tests__/b.ts": `${SITE}\n`,
        },
        [{ file: "server/a.ts", count: 1 }],
      ).args,
    );
    expect(r.stdout).toMatch(/1 site\(s\) in 1 file\(s\)/);
    expect(r.status).toBe(0);
  });

  it("a FIXED site fails until the baseline is lowered (the ratchet)", () => {
    const r = run(fixture({ "server/a.ts": "const x = 1;\n" }, [{ file: "server/a.ts", count: 1 }]).args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/lower the baseline/);
  });
});

describe("lint-curdate · baseline entries the ratchet cannot trust", () => {
  const one = { "server/a.ts": `${SITE}\n` };

  it("an empty reason FAILS", () => {
    const r = run(fixture(one, [{ file: "server/a.ts", count: 1, reason: " " }]).args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/effect class or reason[\s\S]*server\/a\.ts/);
  });

  // PINS: mutation "drop the effect check" (survived the six original tests).
  it("a MISSING effect field FAILS and names the file", () => {
    const r = run(fixture(one, [{ file: "server/a.ts", count: 1, reason: "r" }], { defaults: false }).args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/effect class or reason[\s\S]*server\/a\.ts/);
  });

  // FAILS-ON-OLD: any non-empty string passed as an effect class.
  it("an effect that is not one of the declared classes FAILS", () => {
    const r = run(fixture(one, [{ file: "server/a.ts", count: 1, effect: "staff_today" }]).args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/effect class must be one of/);
  });

  // FAILS-ON-OLD: `n > undefined` is false, so an entry without a count admitted any number of sites.
  it("an entry with no count cannot admit sites: it FAILS and the sites are reported as NEW", () => {
    const r = run(fixture({ "server/a.ts": `${SITE}\n${SITE}\n${SITE}\n` }, [{ file: "server/a.ts" }]).args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/a\.ts\s+0 → 3/);
    expect(r.stderr).toMatch(/count must be a positive integer/);
  });

  // FAILS-ON-OLD: the later duplicate silently raised the allowance under the first entry's reason.
  it("a duplicate entry FAILS, even when its count matches the file", () => {
    const five = { "server/a.ts": `${SITE}\n`.repeat(5) };
    const r = run(fixture(five, [{ file: "server/a.ts", count: 1, reason: "the reviewed one" }, { file: "server/a.ts", count: 5 }]).args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/a\.ts — duplicate entry/);
  });
});

describe("lint-curdate · --baseline only lowers", () => {
  // FAILS-ON-OLD: the old --baseline rewrote B to 2 under B's old reason and the gate went green.
  it("A 1→0 and B 1→2: --baseline REFUSES, names B, writes nothing, and the gate stays red", () => {
    const f = fixture({ "server/a.ts": "const x = 1;\n", "server/b.ts": `${SITE}\n${SITE}\n` }, [
      { file: "server/a.ts", count: 1, reason: "A's reason" },
      { file: "server/b.ts", count: 1, reason: "B's reason" },
    ]);
    const before = readFileSync(f.bl, "utf8");
    const r = run([...f.args, "--baseline"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/only LOWERS counts/);
    expect(r.stderr).toMatch(/server\/b\.ts\s+1 → 2/);
    expect(r.stderr).not.toMatch(/server\/a\.ts/);
    expect(readFileSync(f.bl, "utf8")).toBe(before);
    expect(run(f.args).status).toBe(1);
  });

  // FAILS-ON-OLD: the old --baseline added a new file (empty reason) and exited 0.
  it("a file that is not in the baseline is never added", () => {
    const f = fixture({ "server/new.ts": `${SITE}\n` }, []);
    const before = readFileSync(f.bl, "utf8");
    const r = run([...f.args, "--baseline"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/new\.ts\s+0 → 1/);
    expect(readFileSync(f.bl, "utf8")).toBe(before);
  });

  // FAILS-ON-OLD: the old rewrite took the duplicate's reason and went green. It also caught
  // this gate's own first draft, which looked up the LAST duplicate and raised the first 1→3.
  it("a duplicate entry cannot carry a raise through --baseline", () => {
    const f = fixture({ "server/a.ts": `${SITE}\n`.repeat(3) }, [
      { file: "server/a.ts", count: 1, reason: "the reviewed one" },
      { file: "server/a.ts", count: 5, reason: "the slack" },
    ]);
    const before = readFileSync(f.bl, "utf8");
    const r = run([...f.args, "--baseline"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/a\.ts\s+1 → 3/);
    expect(readFileSync(f.bl, "utf8")).toBe(before);
  });

  // PINS: lowering is the one job --baseline keeps; mutation "refuse everything" fails it.
  it("lowers a count, drops a file at 0, keeps every reason, and the gate then passes", () => {
    const f = fixture({ "server/a.ts": `${SITE}\n`, "server/c.ts": "const x = 1;\n" }, [
      { file: "server/a.ts", count: 2, effect: "staff-today", reason: "A's reason" },
      { file: "server/c.ts", count: 1, reason: "C's reason" },
    ]);
    const r = run([...f.args, "--baseline"]);
    expect(r.status).toBe(0);
    const entries = JSON.parse(readFileSync(f.bl, "utf8")).entries;
    expect(entries).toEqual([{ file: "server/a.ts", count: 1, effect: "staff-today", reason: "A's reason" }]);
    expect(run(f.args).status).toBe(0);
  });
});

describe("lint-curdate · the lexer sees real code, and only real code", () => {
  // FAILS-ON-OLD: "/*" inside "*/*" opened a comment that the cron's "*/15" closed (shopDriverEstimateSync).
  it('a site after the "*/*" Accept header and after a "*/15 * * * *" cron string is counted', () => {
    expectSites(
      sitesIn([
        'const headers = { Accept: "application/json, text/html, */*" };',
        "const a = sql`SELECT 1 FROM t WHERE d = CURDATE()`;",
        'const cron = "*/15 * * * *";',
        "const b = sql`SELECT 1 FROM t WHERE d = CURDATE()`;",
      ]),
      [2, 4],
    );
  });

  // FAILS-ON-OLD: `// …/api/admin/*` opened a comment that ran to the next real one (_core/index.ts, 865 lines).
  it("a site after a `// … /api/admin/*` line comment is counted", () => {
    expectSites(
      sitesIn([
        "// middleware for all /api/admin/* routes",
        "const a = sql`SELECT 1 FROM t WHERE d = CURDATE()`;",
        "/* a real block comment */",
        "const b = sql`SELECT 1 FROM t WHERE d = CURDATE()`;",
      ]),
      [2, 4],
    );
  });

  // PINS: a block comment ends at its first star-slash and nowhere else; `*\/15` in a JSDoc does not end it.
  it("block comments are masked, a JSDoc cron `*\\/15` does not end one, and a site after both is counted", () => {
    expectSites(
      sitesIn([
        "/**",
        ' * Runs on "*\\/15 * * * *" (every quarter hour). CURDATE() here is prose.',
        " */",
        'export const EVERY_15 = "*/15 * * * *";',
        "const a = sql`SELECT 1 FROM t WHERE d = CURDATE()`;",
        "/* CURDATE() in a block comment is not a site */",
      ]),
      [5],
    );
  });

  // FAILS-ON-OLD: `//` not preceded by `:` read as a comment and deleted the rest of the line.
  it("a template holding `//cdn…` or `a//b` keeps the site after it on the same line", () => {
    expectSites(
      sitesIn([
        "const a = sql`SELECT 1 FROM t WHERE u LIKE '//cdn.example.com/%' AND d = CURDATE()`;",
        "const b = `see https://example.com/a//b and ${x} then CURDATE()`;",
      ]),
      [1, 2],
    );
  });

  // FAILS-ON-OLD: "/*" inside the regex opened a comment. PINS: mutation "never recognise a regex".
  it("a regex literal holding `/*`, quotes or a backtick is masked, and the sites after it are counted", () => {
    expectSites(
      sitesIn([
        "const GLOB = /[/*]+$/;",
        "const a = sql`SELECT 1 FROM t WHERE d = CURDATE()`;",
        "const Q = /[\"'`]/g;",
        "const b = sql`SELECT 1 FROM t WHERE d = CURDATE()`;",
        "/* trailing note */",
      ]),
      [2, 4],
    );
  });

  // FAILS-ON-OLD: the old gate counted a CURDATE() inside a SQL `-- ` comment.
  it("a SQL `-- ` comment inside a literal is masked, but `--` inside a SQL string or without a space is not", () => {
    expectSites(
      sitesIn([
        "const a = sql`",
        "  SELECT id FROM bookings",
        "  -- was: WHERE preferredDate < CURDATE()",
        "  WHERE preferredDate < ${todayEt}",
        "`;",
        'const b = "SELECT 1 -- CURDATE() in a comment\\nFROM t WHERE d = CURDATE()";',
        "const c = sql`SELECT CONCAT(name, ' -- ', note), CURDATE() FROM t`;",
        "const d = sql`SELECT 5--3 AS n, CURDATE()`;",
      ]),
      [6, 7, 8],
    );
  });

  // PINS: mutation "case-sensitive matcher" (survived the six original tests).
  it("lowercase curdate() is counted", () => {
    expectSites(sitesIn(["const a = sql`select 1 from t where d = curdate()`;"]), [1]);
  });

  // PINS: mutation "no whitespace tolerance" (survived the six original tests).
  it("CURDATE ( ) is counted", () => {
    expectSites(sitesIn(["const a = sql`SELECT 1 FROM t WHERE d = CURDATE ( )`;"]), [1]);
  });

  // PINS: the removed `:` URL exemption's job — a URL in SQL text must not blind the rest of its line.
  it("a https:// URL before a site on the same line leaves the site counted", () => {
    expectSites(sitesIn(["const a = sql`SELECT 1 FROM t WHERE src = 'https://nickstire.org/x' AND d = CURDATE()`;"]), [1]);
  });

  // PINS: mutations of the regex-vs-division refinements (postfix !, ++, a property named like a keyword).
  it("valid TS division after `x!`, `i++` and `.new` does not make the lexer open a regex", () => {
    expectSites(
      sitesIn([
        "const ratio = total! / count;",
        "let i = 0; i++ / 2;",
        "const share = counts.new / counts.total;",
        "const q = sql`SELECT 1 WHERE d = CURDATE()`;",
      ]),
      [4],
    );
  });

  // FAILS-ON-OLD: .tsx was not scanned. PINS: the `</` and `/>` JSX allowances.
  it(".tsx: JSX closing tags, a self-closing spread and an apostrophe in JSX text do not blind the lexer", () => {
    expectSites(
      sitesIn(
        [
          "export const A = () => <p>{label}</p>;",
          "export const B = (p: P) => <img {...p} />;",
          "export const C = () => <p>Don't wait</p>;",
          "const q = sql`SELECT 1 WHERE d = CURDATE()`;",
        ],
        "server/x.tsx",
      ),
      [4],
    );
  });

  // FAILS-ON-OLD: the old gate passed both; a lexer that loses track must fail, never go quiet.
  it("FAILS CLOSED: an unterminated template, and the documented regex-after-`)` gap, fail with file:line", () => {
    const stray = run(fixture({ "server/a.ts": "const a = `never closed;\nconst b = 1;\n" }).args);
    expect(stray.status).toBe(1);
    expect(stray.stderr).toMatch(/lexer lost track/);
    expect(stray.stderr).toMatch(/server\/a\.ts:1\s+unterminated template literal/);

    const gap = run(fixture({ "server/b.ts": "if (ok) /'/.test(s);\nconst c = 1;\n" }).args);
    expect(gap.status).toBe(1);
    expect(gap.stderr).toMatch(/server\/b\.ts:1\s+unterminated string literal/);
  });
});

describe("lint-curdate · every spelling of the same UTC-date bug", () => {
  const COUNTED = [
    "DATE(NOW())",
    "date( now( ) )",
    "CURRENT_DATE",
    "CURRENT_DATE()",
    "UTC_DATE()",
    "DATE(CURRENT_TIMESTAMP)",
    "DATE(UTC_TIMESTAMP())",
    "DATE(SYSDATE())",
    "DATE(LOCALTIME)",
    "DATE(LOCALTIMESTAMP())",
    "DATE(NOW(3))",
    "CAST(NOW() AS DATE)",
    "CAST(NOW() - INTERVAL 1 DAY AS DATE)",
    "CONVERT(NOW(), DATE)",
    "DATEDIFF(NOW(), lastVisitDate)",
    "DATEDIFF(lastVisitDate, NOW())",
    "DATEDIFF(DATE(COALESCE(a, b)), NOW())",
    "DATE_FORMAT(NOW(), '%Y-%m-01')",
    "DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-01')",
    "TO_DAYS(NOW())",
    "LAST_DAY(NOW())",
    "YEARWEEK(NOW())",
    "WEEK(NOW(), 1)",
    "MONTH(NOW())",
    "YEAR(NOW())",
    "DAY(NOW())",
    "DAYOFMONTH(NOW())",
    "DAYOFWEEK(NOW())",
    "WEEKDAY(NOW())",
    "HOUR(NOW())",
    "EXTRACT(DAY FROM NOW())",
  ];

  // FAILS-ON-OLD: it matched CURDATE() only (DATEDIFF(NOW(),…) x7 and DATE_FORMAT(NOW(),…) x6 are in server/).
  it("each calendar function applied directly to the clock is a site", () => {
    const lines = COUNTED.map((expr, i) => `const s${i} = sql\`SELECT ${expr} AS v FROM t\`;`);
    lines.push("const lv = sql`SELECT DATEDIFF(${customers.lastVisitDate}, NOW()) AS d`;");
    expectSites(sitesIn(lines), lines.map((_, i) => i + 1));
  });

  // PINS: mutations "CONVERT_TZ allowed as a wrapper", "no literal barrier", "match in code", "no \b after CURRENT_DATE".
  it("the converted clock, rolling windows, stored columns, JS code and a string handed to a helper are NOT sites", () => {
    expectSites(
      sitesIn([
        "const a = sql`SELECT DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))`;",
        "const b = sql`SELECT DATEDIFF(DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York')), lastVisitDate)`;",
        "const c = sql`SELECT 1 FROM t WHERE createdAt >= NOW() - INTERVAL 24 HOUR`;",
        "const d = sql`SELECT 1 FROM t WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;",
        "const e = sql`SELECT TIMESTAMPDIFF(MINUTE, startedAt, UTC_TIMESTAMP())`;",
        "const f = `CREATE TABLE x (t TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`;",
        "const g = sql`SELECT DATE(createdAt) AS day, current_date_override FROM t`;",
        // lot.ts: etDate() wraps its argument in CONVERT_TZ, so this is correct ET code.
        'const h = sql`SELECT DATEDIFF(${etDate("NOW()")}, ${etDate("arrivedAt")}) AS dayOffset`;',
        "const i = new Date(now()); const j = new Date(localTimestamp); const k = hour(now());",
        "// const l = sql`SELECT DATE(NOW())`;",
        "const planted = sql`SELECT 1 FROM t WHERE d = CURDATE()`;",
      ]),
      [11],
    );
  });

  // FAILS-ON-OLD: only *.ts was scanned.
  it("scans .tsx .mts .cts .js .jsx .mjs .cjs under server/, still skipping tests", () => {
    const one = `${SITE}\n`;
    const r = run(
      fixture({
        "server/a.tsx": one,
        "server/b.mts": one,
        "server/c.cts": one,
        "server/d.js": one,
        "server/e.jsx": one,
        "server/f.mjs": one,
        "server/g.cjs": one,
        "server/h.test.mjs": one,
        "server/i.spec.tsx": one,
        "server/__tests__/j.js": one,
        "server/k.test.ts": one,
      }).args,
    );
    expect(r.stdout).toMatch(/7 site\(s\) in 7 file\(s\)/);
    for (const f of ["a.tsx", "b.mts", "c.cts", "d.js", "e.jsx", "f.mjs", "g.cjs"]) expect(r.stderr).toContain(`server/${f}`);
    expect(r.stderr).not.toMatch(/h\.test\.mjs|i\.spec\.tsx|__tests__|k\.test\.ts/);
  });
});

describe("lint-curdate · the instrument can see its target", () => {
  // FAILS-ON-OLD: a valued flag without a value fell back to the live repo and passed.
  it("--root with no value exits 2 instead of scanning the live repo", () => {
    const r = run(["--root"]);
    expect(r.status).toBe(2);
    expect(r.stdout, "no scan may run").not.toMatch(/site\(s\)/);
  });

  // FAILS-ON-OLD: a root with no server/ scanned nothing and passed on an empty baseline.
  it("a root with no server/ directory exits 2: nothing scanned is not a pass", () => {
    const r = run(fixture({}).args);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/nothing to scan/);
  });

  // FAILS-ON-OLD: the reported repro — a site planted inside the span the regex stripper
  // swallowed in the REAL shopDriverMirror.ts (the "*/*" Accept header opens it) passed.
  it("REPRO: a site planted after the real shopDriverMirror.ts Accept header is counted", () => {
    const rel = "server/services/shopDriverMirror.ts";
    const lines = readFileSync(join(APP, rel), "utf8").split("\n");
    const header = lines.findIndex((l) => l.includes("*/*"));
    expect(header, `the "*/*" Accept header this repro plants after is gone from ${rel}`).toBeGreaterThan(-1);
    const before = sitesIn(lines, rel).count;
    lines.splice(header + 1, 0, "    const planted = sql`SELECT id FROM invoices WHERE DATE(invoiceDate) = CURDATE()`;");
    const after = sitesIn(lines, rel);
    expect(after.count).toBe(before + 1);
    expect(after.lines).toContain(header + 2);
  });

  it("CLEAN TREE: the real server/ passes against config/curdate-baseline.json", () => {
    const r = run();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no new site/);
    // A pass over a handful of files would be a pass over nothing.
    expect(Number(/(\d+) file\(s\) scanned/.exec(r.stdout)?.[1])).toBeGreaterThan(400);
  });
});

describe("lint-curdate · the lexer agrees with the TypeScript parser on the real tree", () => {
  /**
   * A mis-lexed regex that holds a slash-star opens a block comment that ends at the
   * next real one: the lexer stays "terminated", fails nothing, and goes blind. Only
   * an independent parser sees that. So: every non-space character of every scanned
   * file must be literal text for the gate exactly when TypeScript says it is.
   */
  it("every non-space character is literal text for the gate exactly when it is for TypeScript", async () => {
    const ts = createRequire(join(APP, "package.json"))("typescript") as typeof import("typescript");
    process.env.CURDATE_GATE_AS_LIBRARY = "1";
    let maskSource: (src: string, o: { raw?: boolean; jsx?: boolean }) => { text: string; errors: unknown[] };
    try {
      ({ maskSource } = await import(GATE));
    } finally {
      delete process.env.CURDATE_GATE_AS_LIBRARY;
    }

    const literalMask = (file: string, src: string) => {
      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const keep = new Uint8Array(src.length);
      const K = ts.SyntaxKind;
      const visit = (node: import("typescript").Node) => {
        const start = node.getStart(sf);
        let a = -1;
        let b = -1;
        if (node.kind === K.StringLiteral || node.kind === K.NoSubstitutionTemplateLiteral || node.kind === K.TemplateTail) [a, b] = [start + 1, node.end - 1];
        else if (node.kind === K.TemplateHead || node.kind === K.TemplateMiddle) [a, b] = [start + 1, node.end - 2];
        for (let x = a; x >= 0 && x < b; x++) keep[x] = 1;
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return keep;
    };
    const disagreements = (src: string, keep: Uint8Array, masked: string) => {
      const bad: number[] = [];
      for (let x = 0; x < src.length; x++) {
        if (/\s/.test(src[x]) || (src[x] === "\\" && /[\r\n]/.test(src[x + 1] ?? ""))) continue;
        const mine = !/[\s\x00]/.test(masked[x]);
        if (mine !== (keep[x] === 1)) bad.push(x);
      }
      return bad;
    };

    // Positive control on the comparator: one hidden literal character must be caught.
    const probe = 'const a = "CURDATE()";\n';
    const probeMask = maskSource(probe, { raw: true }).text;
    expect(disagreements(probe, literalMask("p.ts", probe), probeMask)).toEqual([]);
    const blinded = probeMask.slice(0, 11) + " " + probeMask.slice(12);
    expect(disagreements(probe, literalMask("p.ts", probe), blinded)).toEqual([11]);

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "node_modules" && name !== "__tests__") walk(p);
        } else if (/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name) && !/\.(?:test|spec)\.[^.]+$/.test(name)) files.push(p);
      }
    };
    walk(join(APP, "server"));
    expect(files.length).toBeGreaterThan(400);

    let compared = 0;
    const report: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const { text, errors } = maskSource(src, { raw: true, jsx: file.endsWith("x") });
      const bad = disagreements(src, literalMask(file, src), text);
      compared += src.replace(/\s/g, "").length;
      if (errors.length) report.push(`${file}: lexer errors ${JSON.stringify(errors)}`);
      if (bad.length) report.push(`${file}:${src.slice(0, bad[0]).split("\n").length} — ${bad.length} character(s) disagree with TypeScript`);
    }
    expect(report, report.join("\n")).toEqual([]);
    expect(compared, "the comparison must have looked at the tree").toBeGreaterThan(1_000_000);
  }, 60_000);
});
