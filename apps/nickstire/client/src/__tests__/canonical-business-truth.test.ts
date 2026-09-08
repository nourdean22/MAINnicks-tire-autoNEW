/**
 * ONE canonical source for who this business is, and a check that fails when a
 * surface disagrees.
 *
 * ── WHAT WAS ACTUALLY TRUE, swept 2026-08-29 ────────────────────────────────
 * The shop's own tenure was asserted with THREE different years across the
 * repo, plus a fourth off-site:
 *   2018 — BUSINESS.founded.year, and 26 surfaces ("Euclid Ave since 2018")
 *   2019 — shared/voice.ts twice, as GUIDANCE the AI voice is told to speak:
 *          "Moe's been running this since 2019" and "same crew who's been
 *          turning wrenches here since 2019"
 *   2022 — BBB's record for the business (off-site, not in this repo)
 * and the operator identity contradicted itself outright: TrustBlock told every
 * visitor "RUN BY MOE SINCE 2018" while MoesTireBridgePage says the shop
 * "transitioned to new ownership and rebranded as Nick's Tire & Auto".
 *
 * Both cannot be true. A customer who reads two pages sees a business that does
 * not know its own history, and the voice file was actively teaching the
 * contradiction to generated copy.
 *
 * ── WHAT THIS ENFORCES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────
 * It enforces AGREEMENT WITH THE CANONICAL CONSTANT, not a particular year.
 * Whether 2018 is the right year is the owner's fact to settle - BBB says 2022
 * and this code cannot adjudicate that. What it can guarantee is that when he
 * settles it, changing BUSINESS.founded.year moves every surface, and any
 * surface that drifts away fails a test instead of reaching a customer.
 *
 * The phone rule is scoped to the SHOP'S OWN number shape (216-xxx-0005)
 * rather than every phone in the repo, because competitor numbers appear
 * legitimately on comparison pages and a blanket rule would flag them. The real
 * risk is the 862/682 drift already recorded off-site on BBB.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { BUSINESS } from "@shared/business";

const ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = [join(ROOT, "client", "src"), join(ROOT, "shared")];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e === "__tests__" || e === "dist") continue;
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * MENTION IS NOT ASSERTION. A comment that QUOTES a retired value — "was
 * 'RUN BY MOE SINCE 2018'" — is documentation of a fixed defect, not the
 * defect. The first version of this scanner had no such rule and immediately
 * flagged its own fix comments, which is the guard-red-team failure of
 * blocking your own documentation: the next person deletes the explanation to
 * get green, and the reason the rule exists is lost.
 */
function isCommentLine(text: string): boolean {
  const t = text.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*");
}

const FILES = SCAN_DIRS.flatMap((d) => sourceFiles(d));
const LINES: Array<{ file: string; line: number; text: string }> = [];
for (const f of FILES) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  readFileSync(f, "utf8").split("\n").forEach((text, i) => {
    if (!isCommentLine(text)) LINES.push({ file: rel, line: i + 1, text });
  });
}

describe("the scanner sees the codebase", () => {
  // Without this every assertion below passes vacuously against an empty read.
  it("reads a real, non-trivial file set", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(LINES.length).toBeGreaterThan(20000);
  });

  // The comment rule must not become a hole: it has to skip documentation
  // AND still see the same words in code.
  it("skips a comment quoting a retired value, but not code asserting it", () => {
    expect(isCommentLine("            // was RUN BY MOE SINCE 2018")).toBe(true);
    expect(isCommentLine("             * 'Moe's been running this since 2019'")).toBe(true);
    expect(isCommentLine("            {/* was RUN BY MOE SINCE 2018 */}")).toBe(true);
    expect(isCommentLine("            RUN BY MOE SINCE 2018")).toBe(false);
    expect(isCommentLine('    fix: "running this since 2019",')).toBe(false);
  });
});

/* ── the shop's own phone number ─────────────────────────────────────────── */

/** Any phone shaped like the shop's own line. Competitor numbers do not match. */
const SHOP_PHONE_SHAPE = /\(?216\)?[ .-]?(\d{3})[ .-]?0005/g;
const CANONICAL_LAST3 = "862";

describe("the shop's phone number has exactly one value", () => {
  const found = LINES.flatMap((l) =>
    [...l.text.matchAll(SHOP_PHONE_SHAPE)].map((m) => ({ ...l, exchange: m[1] })),
  );

  it("POSITIVE CONTROL: the scan actually finds the number in use", () => {
    expect(found.length).toBeGreaterThan(100);
  });

  it("every shop-shaped phone uses the canonical exchange", () => {
    const wrong = found.filter((f) => f.exchange !== CANONICAL_LAST3);
    expect(
      wrong.map((w) => `${w.file}:${w.line}`),
      `phone drift (BBB already carries 682-0005): ${JSON.stringify(wrong.slice(0, 5))}`,
    ).toEqual([]);
  });

  it("the canonical constant is the one being used", () => {
    expect(BUSINESS.phone.display ?? BUSINESS.phone.e164 ?? "").toContain(CANONICAL_LAST3);
  });

  // MUTATION-STYLE PROOF: the matcher must be able to SEE a wrong number, or
  // the green above means nothing.
  it("the matcher detects a drifted number when one exists", () => {
    const probe = [...'call us at (216) 682-0005 today'.matchAll(SHOP_PHONE_SHAPE)];
    expect(probe).toHaveLength(1);
    expect(probe[0][1]).toBe("682");
  });
});

/* ── how long the shop has operated ──────────────────────────────────────── */

/**
 * Phrases that assert THE SHOP'S OWN tenure. Deliberately narrow: "every Sunday
 * since 2019" is a service schedule and "federal law has required them since
 * 2008" is about TPMS, and neither is a claim about this business's age.
 */
const TENURE_PATTERNS: RegExp[] = [
  /running this since (\d{4})/i,
  /turning wrenches here since (\d{4})/i,
  /serving [^.]{0,60}since (\d{4})/i,
  /on euclid(?: ave)? since (\d{4})/i,
  /run by [a-z]+ since (\d{4})/i,
  /mounting them on euclid ave since (\d{4})/i,
];

describe("the shop's tenure agrees with the canonical constant", () => {
  const claims = LINES.flatMap((l) =>
    TENURE_PATTERNS.flatMap((re) => {
      const m = re.exec(l.text);
      return m ? [{ ...l, year: Number(m[1]) }] : [];
    }),
  );

  it("POSITIVE CONTROL: tenure claims exist and are found", () => {
    expect(claims.length).toBeGreaterThan(0);
  });

  it("every tenure claim uses BUSINESS.founded.year", () => {
    const wrong = claims.filter((c) => c.year !== BUSINESS.founded.year);
    expect(
      wrong.map((w) => `${w.file}:${w.line} says ${w.year}`),
      `tenure drift from BUSINESS.founded.year=${BUSINESS.founded.year}`,
    ).toEqual([]);
  });

  it("the matcher detects a drifted year when one exists", () => {
    const probe = /turning wrenches here since (\d{4})/i.exec("the crew turning wrenches here since 2019");
    expect(Number(probe![1])).toBe(2019);
    expect(Number(probe![1])).not.toBe(BUSINESS.founded.year);
  });
});

/* ── who owns the shop ───────────────────────────────────────────────────── */

/**
 * OWNER-CONFIRMED 2026-09-03: Nick's Tire & Auto is the SAME owner, operating
 * at 17625 Euclid Ave since BUSINESS.founded.year. The business was RENAMED
 * from Moe's Tire & Auto. Ownership never changed, and MoesTireBridgePage now
 * frames it correctly - "a name change under the same owner".
 *
 * That makes TWO claims false, and this block guards both:
 *   "RUN BY MOE ..."                - implies the prior name's owner runs it
 *   "transitioned to new ownership" - implies the owner changed
 *
 * ── WHY THE OLD POSITIVE CONTROL WAS DELETED (2026-09-08) ───────────────────
 * This block used to assert "the new-ownership statement is still on the site"
 * (expect(newOwnership.length).toBeGreaterThan(0)). That was written when
 * /moes-tire did say the location "transitioned to new ownership". The owner
 * then confirmed that is false and #2099 removed the copy - so the assertion
 * had become A REQUIREMENT THAT THE SITE KEEP A FALSE CLAIM.
 *
 * It stayed green on ONE unrelated line: shared/guides.ts's generic advice that
 * a customer should re-evaluate when a shop shows "new ownership, new
 * technicians, declining quality" - a conditional about shops in general, not a
 * claim about this one. Editing that single article sentence would have turned
 * this suite red, and the obvious way to green it again would have been to
 * re-add a false ownership claim to the site.
 *
 * The lesson, and the reason the replacements look the way they do: A POSITIVE
 * CONTROL MUST PIN SOMETHING TRUE, NOT MERELY SOMETHING PRESENT. The controls
 * below are matcher probes - the same convention the phone block already uses -
 * so they prove the patterns can still see the defect without requiring any
 * particular sentence to exist on the site.
 *
 * The ownership-change patterns are ASSERTION-SHAPED on purpose. A bare
 * /new ownership/ would flag the guides.ts sentence above; that false positive
 * is guarded by its own test below, so a future author who widens these
 * patterns finds out immediately.
 */
const PREV_OWNER_PATTERN = /run by moe/i;

const OWNERSHIP_CHANGE_PATTERNS: RegExp[] = [
  /transitioned to new ownership/i,
  /under new ownership/i,
  /new ownership and rebranded/i,
  /changed (?:hands|ownership)/i,
  /new owners? (?:took over|bought)/i,
];

describe("the site tells one true ownership story", () => {
  it("no surface claims the shop is run by the previous name's owner", () => {
    expect(
      LINES.filter((l) => PREV_OWNER_PATTERN.test(l.text)).map((c) => `${c.file}:${c.line}`),
      "same owner, renamed - 'run by Moe' is false (owner-confirmed 2026-09-03)",
    ).toEqual([]);
  });

  it("no surface claims the shop changed ownership", () => {
    expect(
      LINES.filter((l) => OWNERSHIP_CHANGE_PATTERNS.some((p) => p.test(l.text))).map(
        (c) => `${c.file}:${c.line}`,
      ),
      "the shop was renamed, never sold (owner-confirmed 2026-09-03)",
    ).toEqual([]);
  });

  // MUTATION-STYLE PROOF: both matchers must be able to SEE the claim, or the
  // two greens above mean nothing.
  it("the matchers detect each false claim if it returns", () => {
    expect(PREV_OWNER_PATTERN.test("RUN BY MOE SINCE 2018")).toBe(true);
    expect(
      OWNERSHIP_CHANGE_PATTERNS.some((p) =>
        p.test("the shop transitioned to new ownership and rebranded as Nick's Tire & Auto"),
      ),
    ).toBe(true);
  });

  // FALSE-POSITIVE GUARD: generic advice that merely mentions the words is not
  // a claim about THIS shop. This is the line the deleted control depended on.
  it("does not flag generic advice that only mentions new ownership", () => {
    const generic =
      "If something changes - new ownership, new technicians, declining quality - it is okay to re-evaluate.";
    expect(OWNERSHIP_CHANGE_PATTERNS.some((p) => p.test(generic))).toBe(false);
  });
});

/* -- weekday opening hours: one canonical value (8AM), no drift ----------- */

/**
 * The shop opens 8AM Mon-Sat (shared/business.ts hours.structured). A page
 * claiming "Mon-Sat 9-6" tells an early walk-in the wrong open time and
 * contradicts every other surface. That drift shipped once on
 * NoCreditCheckTiresPage; this guard keeps it from returning. Sunday IS 9-4,
 * so the matcher is scoped to the Mon-Sat span only and must not flag Sunday.
 */
const WEEKDAY_OPEN_AT_9 = /Mon(?:day)?[ ]?[-–][ ]?Sat(?:urday)?[ ]?9[ ]?[-–][ ]?6/i;

describe("the shop's weekday hours open at 8, everywhere", () => {
  it("no customer surface claims Mon-Sat 9-6 (canonical is 8-6)", () => {
    const wrong = LINES.filter((l) => WEEKDAY_OPEN_AT_9.test(l.text));
    expect(
      wrong.map((w) => `${w.file}:${w.line}`),
      `weekday-hours drift (canonical Mon-Sat is 8-6): ${JSON.stringify(wrong.slice(0, 5))}`,
    ).toEqual([]);
  });

  it("the canonical constant opens Mon-Sat at 08:00", () => {
    expect(BUSINESS.hours.structured.monday).toMatch(/^08:00/);
  });

  // MUTATION-STYLE PROOF: the matcher must SEE a 9-6 weekday claim and must
  // NOT fire on the correct 8-6 or on Sunday's real 9-4.
  it("the matcher detects a drifted 9-6 and ignores correct hours", () => {
    expect(WEEKDAY_OPEN_AT_9.test("we're here Monday-Saturday 9-6 and Sunday 9-4")).toBe(true);
    expect(WEEKDAY_OPEN_AT_9.test("Mon-Sat 8-6, Sun 9-4")).toBe(false);
    expect(WEEKDAY_OPEN_AT_9.test("Sunday 9-4")).toBe(false);
  });
});
