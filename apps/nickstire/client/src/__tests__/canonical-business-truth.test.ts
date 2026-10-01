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
import { BRAKE_PRICE, OIL_PRICE } from "@shared/pricing";
import { findVoiceViolations, KILL_RULES } from "@shared/voice";

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
  // "* " / "*/" / a bare "*" continue a block comment. "*No credit check
  // required." is a JSX footnote, which is copy (independent review, 2026-10-01).
  return t.startsWith("//") || /^\*(?:\s|\/|$)/.test(t) || t.startsWith("/*") || t.startsWith("{/*");
}

/**
 * The non-comment lines of a file. A block comment opened at the start of a
 * line ("/*", "/**", or JSX "{/*") runs to the line that closes it, so prose
 * inside a multi-line JSX comment is documentation too: the per-line rule
 * alone read "TireSizePage ... start around $25-60 each" in a comment as copy.
 */
function codeLines(text: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let inBlock = false;
  text.split("\n").forEach((t, i) => {
    const trimmed = t.trim();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      return;
    }
    if ((trimmed.startsWith("/*") || trimmed.startsWith("{/*")) && !trimmed.includes("*/")) {
      inBlock = true;
      return;
    }
    if (!isCommentLine(t)) out.push({ line: i + 1, text: t });
  });
  return out;
}

const FILES = SCAN_DIRS.flatMap((d) => sourceFiles(d));
const LINES: Array<{ file: string; line: number; text: string }> = [];
for (const f of FILES) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  for (const l of codeLines(readFileSync(f, "utf8"))) LINES.push({ file: rel, ...l });
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
    expect(isCommentLine("            *No credit check required.")).toBe(false);
    expect(isCommentLine("             */")).toBe(true);
    const lines = codeLines(["copy one", "  {/* a JSX comment", "     that wraps */}", "copy two", "/**", " * doc", " */", "copy three"].join("\n"));
    expect(lines.map((l) => l.text)).toEqual(["copy one", "copy two", "copy three"]);
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

/**
 * Every arm carries its OWN fixture. The live scan is expected to find nothing,
 * so without a per-arm canary a deleted or mistyped arm goes inert in silence
 * and the suite stays green - the failure mode a single shared fixture already
 * hid here once (found in review, 2026-09-08).
 *
 * The sale/takeover arms are deliberately SUBJECT-ANCHORED. A bare /sold/ hits
 * "what the shop sold" in admin copy, and /sold to [A-Z]/ hits "the stolen
 * converter is sold to scrap metal dealers" in shared/guides.ts, because the
 * `i` flag defeats the capital letter. Both were caught by scanning the live
 * corpus before these landed; keep that habit if you add an arm.
 */
const OWNERSHIP_CHANGE_ARMS: Array<{ label: string; pattern: RegExp; fixture: string }> = [
  { label: "transitioned to new ownership", pattern: /transitioned to new ownership/i,
    fixture: "the location transitioned to new ownership in 2022" },
  { label: "under new ownership", pattern: /under new ownership/i,
    fixture: "the shop is under new ownership" },
  { label: "new ownership and rebranded", pattern: /new ownership and rebranded/i,
    fixture: "new ownership and rebranded as Nick's" },
  { label: "changed hands", pattern: /changed hands/i,
    fixture: "the garage changed hands in 2022" },
  { label: "ownership moved", pattern: /ownership (?:transferred|changed|passed|moved)/i,
    fixture: "ownership transferred to Nick in 2022" },
  { label: "the shop was sold", pattern: /(?:shop|business|store|garage)\s+(?:was|were|been)\s+(?:sold|acquired)/i,
    fixture: "Moe's shop was sold in 2022" },
  { label: "sold the shop", pattern: /(?:sold|transferred)\s+(?:the\s+|this\s+)?(?:shop|business|store|garage)\b/i,
    fixture: "the family sold the shop to a new operator" },
  { label: "Moe's was sold", pattern: /moe'?s\b[^.]{0,30}\b(?:sold|acquired|bought out)\b/i,
    fixture: "Moe's was sold to Nick" },
  { label: "took over the shop", pattern: /(?:took|taken)\s+over\s+(?:the\s+|this\s+)?(?:shop|business|store|garage)\b/i,
    fixture: "Nick took over the shop in 2022" },
  { label: "new owners took over", pattern: /new owners?\s+(?:took over|bought)/i,
    fixture: "new owners took over in 2022" },
];

/** Generic advice that merely MENTIONS the words is not a claim about this shop. */
const GENERIC_ADVICE_CONTROL =
  "If something changes - new ownership, new technicians, declining quality - it is okay to re-evaluate.";

describe("the site tells one true ownership story", () => {
  it("no surface claims the shop is run by the previous name's owner", () => {
    expect(
      LINES.filter((l) => PREV_OWNER_PATTERN.test(l.text)).map((c) => `${c.file}:${c.line}`),
      "same owner, renamed - 'run by Moe' is false (owner-confirmed 2026-09-03)",
    ).toEqual([]);
  });

  it("no surface claims the shop changed ownership", () => {
    expect(
      LINES.filter((l) => OWNERSHIP_CHANGE_ARMS.some((a) => a.pattern.test(l.text))).map(
        (c) => `${c.file}:${c.line}`,
      ),
      "the shop was renamed, never sold (owner-confirmed 2026-09-03)",
    ).toEqual([]);
  });

  it("the previous-owner matcher detects the claim if it returns", () => {
    expect(PREV_OWNER_PATTERN.test("RUN BY MOE SINCE 2018")).toBe(true);
  });

  // PER-ARM CANARY: the green above is only meaningful if every arm can still
  // see its own defect. One shared fixture would leave nine of ten unproven.
  it.each(OWNERSHIP_CHANGE_ARMS)("ownership arm $label detects its own claim", ({ pattern, fixture }) => {
    expect(pattern.test(fixture)).toBe(true);
  });

  // FALSE-POSITIVE GUARD: this is the line the DELETED positive control used to
  // depend on. No arm may match it, or the guard starts flagging generic prose.
  it("no arm flags generic advice that only mentions new ownership", () => {
    expect(
      OWNERSHIP_CHANGE_ARMS.filter((a) => a.pattern.test(GENERIC_ADVICE_CONTROL)).map((a) => a.label),
    ).toEqual([]);
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

/* -- copy the server renders: llms.txt, website chat, GBP/ad generators, SMS, voice -- */

/**
 * These files hold customer copy written in server code. The hours, ZIP, price
 * and claim checks below read them alongside client/src and shared, with the
 * same comment rule.
 */
const SERVER_COPY_FILES = [
  "server/_core/index.ts",
  "server/gemini.ts",
  "server/services/chatTools.ts",
  "server/services/gbpContentGenerator.ts",
  "server/services/adStudio/adCopyGen.ts",
  "server/services/smsReplyPlanner.ts",
  "server/services/nickSmsPersona.ts",
  "server/services/vapi.ts",
];
const SERVER_LINES: Array<{ file: string; line: number; text: string }> = [];
for (const rel of SERVER_COPY_FILES) {
  for (const l of codeLines(readFileSync(join(ROOT, rel), "utf8"))) SERVER_LINES.push({ file: rel, ...l });
}
const COPY_LINES = [...LINES, ...SERVER_LINES];

describe("the server copy files are read", () => {
  it("every listed file contributes lines (a rename cannot silently drop one)", () => {
    expect(SERVER_LINES.length).toBeGreaterThan(1000);
    for (const rel of SERVER_COPY_FILES) expect(SERVER_LINES.some((l) => l.file === rel), rel).toBe(true);
  });
});

/* -- weekday hours, any drift: the 9-6 rule above only saw one spelling ---- */

/**
 * 2026-10-01: /wheel-alignment-cleveland said "9am-6pm Mon-Sat" while its own
 * header said 8AM, and WEEKDAY_OPEN_AT_9 above stayed green: it matches
 * "Mon-Sat 9-6" only, day first and without "am". These matchers read the open
 * and close hour from either order, with or without am/pm, and compare both to
 * BUSINESS.hours.structured.monday instead of banning one wrong value. Sunday's
 * span written just before "Mon-Sat" is Sunday's, and an hour is never read
 * out of a ":00" minutes field.
 */
const WEEKDAY_SPAN_DAY_FIRST =
  /Mon(?:day)?\s?[-–]\s?Sat(?:urday)?[:,]?\s?(\d{1,2})(?::\d{2})?\s?(?:a\.?m\.?)?\s?[-–]\s?(\d{1,2})(?::\d{2})?/gi;
const WEEKDAY_SPAN_TIME_FIRST =
  /(?<!Sun[a-z]*\b[^\d\n]{0,15})(?<![\d:])\b(\d{1,2})(?::\d{2})?\s?(?:a\.?m\.?)?\s?[-–]\s?(\d{1,2})(?::\d{2})?\s?(?:p\.?m\.?)?[\s,·]{1,4}Mon(?:day)?\s?[-–]\s?Sat(?:urday)?/gi;

function weekdaySpans(text: string): Array<{ open: number; close: number }> {
  return [WEEKDAY_SPAN_DAY_FIRST, WEEKDAY_SPAN_TIME_FIRST].flatMap((re) =>
    [...text.matchAll(re)].map((m) => ({ open: Number(m[1]), close: Number(m[2]) })),
  );
}

const CANON_OPEN = Number(BUSINESS.hours.structured.monday.slice(0, 2));
const CANON_CLOSE = Number(BUSINESS.hours.structured.monday.slice(6, 8));
const isCanonicalSpan = (s: { open: number; close: number }) =>
  s.open === CANON_OPEN && (s.close === CANON_CLOSE || s.close === CANON_CLOSE - 12);

describe("every Mon-Sat hours span matches BUSINESS.hours", () => {
  it("no span on a customer surface opens or closes at a different hour", () => {
    const wrong = COPY_LINES.flatMap((l) =>
      weekdaySpans(l.text).filter((s) => !isCanonicalSpan(s)).map((s) => `${l.file}:${l.line} says ${s.open}-${s.close}`),
    );
    expect(wrong).toEqual([]);
  });

  // MATCHER PROBES, not corpus counts: a count of canonical literals would go
  // red the day someone replaces the literals with BUSINESS.hours, which is the
  // fix this file wants (see the 2026-09-08 note above).
  it("the matchers read both orders and both spellings", () => {
    expect(weekdaySpans("17625 Euclid Ave · 9am-6pm Mon-Sat · walk-in welcome")).toEqual([{ open: 9, close: 6 }]);
    expect(weekdaySpans("Mon–Sat 9 AM–6 PM")).toEqual([{ open: 9, close: 6 }]);
    expect(weekdaySpans("Monday–Saturday: 7:00 AM–6:00 PM")).toEqual([{ open: 7, close: 6 }]);
  });

  it("the real hours pass, and Sunday's own span is not read as the weekday's", () => {
    for (const ok of [
      "Mon–Sat 8AM–6PM, Sun 9AM–4PM",
      "Sun 9–4 · Mon–Sat 8–6",
      "Open Sunday 9–4, Mon–Sat 8–6.",
      "Sunday: 9–4, Mon–Sat 8–6",
      "Sundays & holidays 9-4, Mon-Sat 8-6",
      "Sunday 9:00 AM–4:00 PM, Monday–Saturday 8:00 AM–6:00 PM",
    ]) {
      expect(weekdaySpans(ok).every(isCanonicalSpan), ok).toBe(true);
    }
    expect(weekdaySpans("Sunday 9am-4pm")).toEqual([]);
  });
});

/* -- the shop's ZIP ---------------------------------------------------------- */

/**
 * 2026-10-01: shared/guides.ts told customers to ship tires to "17625 Euclid
 * Ave, Cleveland, OH 44110". The ZIP is 44112: BUSINESS.address.zip, Cuyahoga
 * County parcel 117-07-027 and the Census geocoder agree. Nothing read ZIPs in
 * copy before; business-logic.test.ts checks only the constant. JSON-LD writes
 * the ZIP on its own as postalCode, so that shape is read too.
 */
const SHOP_ZIP_SHAPE = /17625\s+Euclid[^\n]{0,40}?\b(44\d{3})\b/gi;
const POSTAL_CODE_SHAPE = /postalCode["']?\s*:\s*["'](\d{5})["']/g;

function zipsIn(text: string): string[] {
  return [SHOP_ZIP_SHAPE, POSTAL_CODE_SHAPE].flatMap((re) => [...text.matchAll(re)].map((m) => m[1]));
}

describe("the shop's ZIP has exactly one value", () => {
  it("every ZIP written with the street address, or as postalCode, is BUSINESS.address.zip", () => {
    const wrong = COPY_LINES.flatMap((l) =>
      zipsIn(l.text).filter((z) => z !== BUSINESS.address.zip).map((z) => `${l.file}:${l.line} says ${z}`),
    );
    expect(wrong).toEqual([]);
  });

  it("the matchers detect a drifted ZIP in both shapes", () => {
    expect(zipsIn("have them shipped to 17625 Euclid Ave, Cleveland, OH 44110, and")).toEqual(["44110"]);
    expect(zipsIn('address: { "@type": "PostalAddress", postalCode: "44110" }')).toEqual(["44110"]);
    expect(zipsIn("17625 Euclid Ave, Cleveland, OH 44112")).toEqual(["44112"]);
  });
});

/* -- prices the shop states as its own --------------------------------------- */

/**
 * 2026-10-01: brake pads were "$89 per axle" in the /brakes FAQ JSON-LD, "$129"
 * on every blog post's CTA and "$149" on /brakes itself; oil was "$29.99",
 * "$35", "$39" and "$69.99" on blog and guide surfaces against $49 / $80.
 * These read "<pads|oil change|conventional|synthetic> ... from / starts at $N",
 * the shape the shop uses for its own price. A sentence naming a dealer, chain
 * or competitor, or speaking of typical or average market prices, is skipped,
 * and so are pads-plus-rotors and resurfacing jobs.
 */
const PAD_PRICE_CLAIM =
  /\bpads?\b(?:(?!rotor|resurfac)[^.\n$+]){0,40}?\b(?:start(?:s|ing)? at|(?<!rang(?:e|es|ing) )from)\s+(?:just |only )?\$(\d{2,3})/gi;
const OIL_PRICE_CLAIM =
  /\b(?:oil changes?|conventional|synthetic)\b[^.\n$]{0,30}?\b(?:from|start(?:s|ing)? at)\s+(?:just |only )?\$(\d{2,3})(?:\.\d{2})?/gi;
const STALE_OIL_SPECIAL = /\$(?:29\.99|39)\s+oil change/gi;
const NOT_THE_SHOPS_PRICE =
  /\b(?:dealers?|dealerships?|chains?|valvoline|jiffy|midas|firestone|mavis|conrad'?s|monro|pep boys|typical(?:ly)?|average|independent shops|elsewhere|market)\b/i;

function shopPrices(text: string, re: RegExp): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(re)) {
    const from = text.lastIndexOf(".", m.index ?? 0) + 1;
    const sentence = text.slice(from, (m.index ?? 0) + m[0].length);
    if (!NOT_THE_SHOPS_PRICE.test(sentence)) out.push(Number(m[1]));
  }
  return out;
}

describe("prices the shop states as its own match shared/pricing.ts", () => {
  const OIL_PRICES: number[] = [OIL_PRICE.conventional, OIL_PRICE.fullSynthetic];

  it("every 'pads from $N' is BRAKE_PRICE.padsStarting", () => {
    const wrong = COPY_LINES.flatMap((l) =>
      shopPrices(l.text, PAD_PRICE_CLAIM).filter((p) => p !== BRAKE_PRICE.padsStarting).map((p) => `${l.file}:${l.line} says $${p}`),
    );
    expect(wrong).toEqual([]);
  });

  it("every 'oil change from $N' is a price in OIL_PRICE, and no stale special survives", () => {
    const wrong = COPY_LINES.flatMap((l) =>
      shopPrices(l.text, OIL_PRICE_CLAIM).filter((p) => !OIL_PRICES.includes(p)).map((p) => `${l.file}:${l.line} says $${p}`),
    );
    const stale = COPY_LINES.filter((l) => l.text.match(STALE_OIL_SPECIAL)).map((l) => `${l.file}:${l.line}`);
    expect([...wrong, ...stale]).toEqual([]);
  });

  it("the matchers see the shop's drifted prices", () => {
    expect(shopPrices("Pads start at $89 per axle installed", PAD_PRICE_CLAIM)).toEqual([89]);
    expect(shopPrices("pad replacement at our shop starts at $129 per axle", PAD_PRICE_CLAIM)).toEqual([129]);
    expect(shopPrices("Pads from $149/axle, pads + rotors from $279/axle", PAD_PRICE_CLAIM)).toEqual([149]);
    expect(shopPrices("Full conventional oil change from $29.99.", OIL_PRICE_CLAIM)).toEqual([29]);
    expect(shopPrices("Oil changes from $39.99. Brake pads from $149.99 per axle.", OIL_PRICE_CLAIM)).toEqual([39]);
    expect(shopPrices("At Nick's: conventional starts at $35, full synthetic starts at $65.", OIL_PRICE_CLAIM)).toEqual([35, 65]);
    expect(shopPrices("synthetic from just $69 today", OIL_PRICE_CLAIM)).toEqual([69]);
    expect("our [$39 oil change special](/oil-change)".match(STALE_OIL_SPECIAL)).not.toBeNull();
  });

  it("the matchers skip market ranges, competitors and other jobs", () => {
    expect(shopPrices("pad replacement typically ranges from $150 to $350", PAD_PRICE_CLAIM)).toEqual([]);
    expect(shopPrices("Dealer brake pads start at $250", PAD_PRICE_CLAIM)).toEqual([]);
    expect(shopPrices("Pads and resurfacing from $199", PAD_PRICE_CLAIM)).toEqual([]);
    expect(shopPrices("Full synthetic at Valvoline starts at $99", OIL_PRICE_CLAIM)).toEqual([]);
    expect(shopPrices("Full synthetic at chains: $60 to $90.", OIL_PRICE_CLAIM)).toEqual([]);
  });
});

/* -- unsupported claims: the kernel's claim.* rules over every customer line -- */

/**
 * The rules live in shared/voice.ts (reason "claim") so the copy linter, the IG
 * generator and critic prompts, Ad Studio's lintAdCopy, the SMS reply planner
 * and this scan read one list. The linter checks only ADDED lines and
 * voice-compliance.test.ts only a fixed set of fields, so neither could see the
 * "no credit check" pitch on every prerendered page, the E-Check "30-day
 * deadline" or "pass guaranteed". This scan reads every line, zero tolerance,
 * line by line and with each file's lines joined, because JSX prose wraps.
 *
 * Text is normalized the way a reader sees it: HTML entities and curly quotes
 * decoded, escaped quotes in source strings unescaped (no \"do it twice\" risk
 * hid behind its backslashes), a literal \n read as a line break, and inline
 * tags removed ("Approved <strong>on the spot</strong>"). Tag removal runs as a
 * SECOND variant beside the untagged text, never instead of it: a stray "<" and
 * ">" on one line could otherwise swallow a claim between them.
 *
 * SCOPE, widened 2026-10-01 after an independent review found claims the first
 * version never read: client/src and shared; EVERY non-test file under server/
 * (a customer SMS template lived in server/services, outside the eight named
 * copy files); client/index.html (meta and JSON-LD on every page); and the src
 * of each workspace package nickstire depends on (packages/meta-ads-architect
 * wrote paid-ad copy with "no credit check" in it).
 *
 * Skipped, with reasons: shared/voice.ts and the ad package's compliance
 * scanner (their patterns ARE the banned phrases); shared/proof.ts
 * (testimonials consumed only by an admin screen, which a canary below pins). Admin files are scanned as the admin surface, which the
 * claim rules exempt, exactly as the linter does.
 */
const CLAIM_RULE_IDS = KILL_RULES.filter((r) => r.reason === "claim").map((r) => r.id);
const NON_CLAIM_RULE_IDS = KILL_RULES.filter((r) => r.reason !== "claim").map((r) => r.id);
const CLAIM_SCAN_SKIP = new Set([
  "shared/voice.ts",
  "shared/proof.ts",
  // the ad package's own compliance scanner: its patterns ARE the banned phrases
  "../../packages/meta-ads-architect/src/compliance/scanner.ts",
]);

/** The src of every workspace package nickstire declares, read from package.json. */
function workspacePackageSrcDirs(): string[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const wanted = new Set(
    Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
      .filter(([, v]) => String(v).startsWith("workspace:"))
      .map(([k]) => k),
  );
  const packagesDir = join(ROOT, "..", "..", "packages");
  return readdirSync(packagesDir)
    .map((d) => join(packagesDir, d))
    .filter((d) => {
      try {
        return wanted.has(JSON.parse(readFileSync(join(d, "package.json"), "utf8")).name);
      } catch {
        return false;
      }
    })
    .map((d) => join(d, "src"));
}

const PACKAGE_SRC_DIRS = workspacePackageSrcDirs();
const CLAIM_EXTRA_FILES = [
  ...sourceFiles(join(ROOT, "server")),
  join(ROOT, "client", "index.html"),
  ...PACKAGE_SRC_DIRS.flatMap((d) => sourceFiles(d)),
].filter((f) => !SERVER_COPY_FILES.includes(relative(ROOT, f).replace(/\\/g, "/")));
const CLAIM_EXTRA_LINES: Array<{ file: string; line: number; text: string }> = [];
for (const f of CLAIM_EXTRA_FILES) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  for (const l of codeLines(readFileSync(f, "utf8"))) CLAIM_EXTRA_LINES.push({ file: rel, ...l });
}
const CLAIM_LINES = [...COPY_LINES, ...CLAIM_EXTRA_LINES];

const decodeCopy = (t: string) =>
  t
    .replace(/\\(["'])/g, "$1")
    .replace(/\\n/g, " ")
    .replace(/&apos;|&#39;|&#x27;|&#8217;|&rsquo;|&lsquo;|[\u2018\u2019]/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;|[\u201c\u201d]/g, '"')
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/&amp;/g, "&");
const stripTags = (t: string) => t.replace(/<[^<>\n]{1,200}>/g, "");
const VARIANTS: Array<(t: string) => string> = [decodeCopy, (t) => stripTags(decodeCopy(t))];

function rawClaimHits(file: string, text: string): Array<{ ruleId: string; match: string; index: number }> {
  if (CLAIM_SCAN_SKIP.has(file)) return [];
  const surface = file.includes("/admin/") ? "admin" : "web";
  return findVoiceViolations(text, { surface, skipRuleIds: NON_CLAIM_RULE_IDS }).map((v) => ({
    ruleId: v.ruleId,
    match: v.match,
    index: v.index,
  }));
}

/** Line pass only: both variants of one line. */
function claimHits(file: string, text: string): Array<{ ruleId: string; match: string }> {
  return VARIANTS.flatMap((norm) => rawClaimHits(file, norm(text)));
}

function claimFindings(lines: Array<{ file: string; line: number; text: string }>): string[] {
  const found = new Set<string>();
  const byFile = new Map<string, Array<{ line: number; text: string }>>();
  for (const l of lines) {
    for (const h of claimHits(l.file, l.text)) found.add(`${l.file}:${l.line} [${h.ruleId}] "${h.match}"`);
    const list = byFile.get(l.file) ?? [];
    list.push(l);
    byFile.set(l.file, list);
  }
  // Joined pass: a phrase split across wrapped lines. Reported at its first line.
  for (const [file, list] of byFile) {
    for (const norm of VARIANTS) {
      let joined = "";
      const starts: number[] = [];
      for (const l of list) {
        starts.push(joined.length);
        joined += norm(l.text.trim()) + " ";
      }
      for (const h of rawClaimHits(file, joined)) {
        let i = 0;
        while (i + 1 < starts.length && starts[i + 1] <= h.index) i++;
        const key = `${file}:${list[i].line} [${h.ruleId}]`;
        if (![...found].some((f) => f.startsWith(key))) found.add(`${key} "${h.match}" (wrapped)`);
      }
    }
  }
  return [...found];
}

const scanOne = (text: string, file = "client/src/pages/Canary.tsx") =>
  claimFindings([{ file, line: 1, text }]).map((f) => f.match(/\[(claim\.[a-z-]+)\]/)?.[1]);

describe("no unsupported claim reaches a customer surface", () => {
  it("the kernel carries the claim rules", () => {
    expect(CLAIM_RULE_IDS.length).toBeGreaterThanOrEqual(7);
  });

  it("the widened scope is actually read", () => {
    expect(CLAIM_EXTRA_FILES.length).toBeGreaterThan(300);
    expect(CLAIM_EXTRA_LINES.some((l) => l.file === "client/index.html")).toBe(true);
    expect(CLAIM_EXTRA_LINES.some((l) => l.file.startsWith("server/services/declinedRecoverySequence"))).toBe(true);
    expect(CLAIM_EXTRA_LINES.some((l) => l.file.includes("packages/meta-ads-architect/src/"))).toBe(true);
  });

  it("no customer-copy line makes a claim the shop cannot back", () => {
    expect(claimFindings(CLAIM_LINES)).toEqual([]);
  });

  it("shared/proof.ts, which the scan skips, is still consumed only by admin screens", () => {
    // The skip is safe only while no customer surface imports it.
    const importers = [...FILES, ...CLAIM_EXTRA_FILES]
      .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
      .filter((rel) => rel !== "shared/proof.ts" && /from ["'](?:@shared|(?:\.\.\/)+shared)\/proof["']/.test(readFileSync(join(ROOT, rel), "utf8")));
    expect(importers.length).toBeGreaterThan(0);
    for (const rel of importers) expect(rel, `${rel} imports shared/proof.ts`).toContain("/admin/");
  });

  // PER-RULE CANARY through the SAME function the corpus scan uses.
  it.each(KILL_RULES.filter((r) => r.reason === "claim").map((r) => [r.id, r.label] as const))(
    "%s is caught by the corpus scan",
    (id, label) => {
      expect(scanOne(label)).toContain(id);
    },
  );

  // MUST-FLAG: wordings that were live on 2026-10-01, or that the PR removed by
  // hand and an independent review showed the first rules would let back in. A
  // canary that only fires each rule on its own label cannot show a rule is too
  // narrow; these can.
  it.each([
    ["claim.no-credit-check", "Pre-approval takes 2 minutes with no hard credit check."],
    ["claim.no-credit-check", "all $10 down with no traditional credit check"],
    ["claim.no-credit-check", "Bad credit? No credit check? No problem."],
    ["claim.no-credit-check", "We don't check credit."],
    ["claim.no-credit-check", "We don't do credit checks."],
    ["claim.no-credit-check", "zero credit check, credit-check-free"],
    ["claim.no-credit-check", "We say 'no credit check' because we mean it."],
    ["claim.no-credit-check", "Need tires with no credit check? We've got you covered."],
    ["claim.no-credit-check", "Searching for no credit check tires? You found them."],
    ["claim.no-credit-impact", "No credit history needed to check, and checking doesn't ding your score."],
    ["claim.no-credit-impact", "Pre-qualified in 60 seconds with a soft credit pull (no impact to your score)"],
    ["claim.no-credit-impact", "checking approval does not require a credit history or a hard credit pull"],
    ["claim.no-credit-impact", "a credit check that doesn't show on your report and doesn't drop your score"],
    ["claim.no-credit-impact", "Applying won't affect your FICO score."],
    ["claim.no-credit-impact", "won't impact your credit score"],
    ["claim.no-credit-impact", "soft inquiry only, soft pre-qualification"],
    ["claim.approval-promise", "Need tires? Acima approves you on the spot"],
    ["claim.approval-promise", "Walk-ins 7 days, payment programs on the spot."],
    ["claim.approval-promise", "Most customers qualify for $500-$5,000."],
    ["claim.approval-promise", "Soft credit pre-qualification takes 60 seconds"],
    ["claim.approval-promise", "Approved in seconds, guaranteed approval"],
    ["claim.approval-promise", "Get approved today. Same-Day Approval."],
    ["claim.approval-promise", "Most approvals come back in minutes, and approval is immediate."],
    ["claim.approval-promise", "most customers approve up to $5,000"],
    ["claim.approval-promise", "the majority of applicants qualify"],
    ["claim.approval-promise", "Pre-qualification is instant"],
    ["claim.approval-promise", "soft pre-qual in 60s"],
    ["claim.approval-promise", "Instant approvals. Get pre-approved."],
    ["claim.approval-promise", "Pre-qualifying takes about a minute, no obligation."],
    ["claim.approval-promise", "Snap and Koalafi both advertise decisions in seconds for many applicants"],
    ["claim.lease-no-interest", "Some plans offer 0% interest for qualified buyers."],
    ["claim.echeck-deadline", "You have 30 days and one free retest after a failure."],
    ["claim.echeck-deadline", "Failed Ohio E-Check has a 30-day repair window. Day 31 = parking tickets."],
    ["claim.echeck-deadline", "you have 30 days to make repairs and retest at no additional cost"],
    ["claim.echeck-deadline", "If your car fails E-Check, you have 30 days to get it fixed"],
    ["claim.echeck-deadline", "30-day clock to fix it before registration expires."],
    ["claim.echeck-deadline", "If your vehicle fails, you have 60 days to make repairs and retest for free."],
    ["claim.echeck-deadline", "The retest is free within 60 days of the failure."],
    ["claim.echeck-deadline", "Your registration will be suspended."],
    ["claim.echeck-pass-guarantee", "We handle emissions testing and can fix it so you pass the first time."],
    ["claim.echeck-pass-guarantee", "then fix the failure so you pass, no \"do it twice\" risk"],
    ["claim.echeck-pass-guarantee", "We guarantee your car passes."],
    ["claim.echeck-pass-guarantee", "Failed E-Check?\nWe'll get you passing."],
    ["claim.echeck-pass-guarantee", "we do the state test"],
    ["claim.echeck-pass-guarantee", "We'll run your E-Check while you wait."],
    ["claim.echeck-pass-guarantee", "we'll get you legal"],
    ["claim.echeck-certified", "Ohio E-Check Emissions Testing & Repair. Certified station."],
    ["claim.echeck-certified", "Ohio E-Check Certified"],
    ["claim.echeck-certified", "State-certified emissions repair, free readiness check first."],
  ])("%s flags: %s", (id, text) => {
    expect(scanOne(text)).toContain(id);
  });

  it("decodes what the reader sees: entities, escaped quotes, a literal \\n, inline tags", () => {
    expect(scanOne("doesn&apos;t ding your score")).toContain("claim.no-credit-impact");
    expect(scanOne(String.raw`then fix the failure so you pass, no \"do it twice\" risk`)).toContain("claim.echeck-pass-guarantee");
    expect(scanOne(String.raw`'won\'t hurt your credit'`)).toContain("claim.no-credit-impact");
    expect(scanOne("Approved <strong>on the spot</strong>.")).toContain("claim.approval-promise");
    expect(scanOne("Snap\u2019s line: applying won\u2019t affect your credit score")).toContain("claim.no-credit-impact");
  });

  it("the joined pass catches a claim no single line holds", () => {
    const wrapped = [
      { file: "client/src/data/X.tsx", line: 10, text: "          Applying for any of your options won't" },
      { file: "client/src/data/X.tsx", line: 11, text: "          affect your credit. Come talk to us." },
    ];
    // The line pass alone sees nothing...
    expect(wrapped.flatMap((l) => claimHits(l.file, l.text))).toEqual([]);
    // ...so a finding here can only come from the joined pass.
    const found = claimFindings(wrapped);
    expect(found.some((f) => f.includes("claim.no-credit-impact") && f.endsWith("(wrapped)"))).toBe(true);
  });

  it("a footnote line that starts with * is copy, not a comment", () => {
    const lines = ["            *No credit check required."]
      .filter((t) => !isCommentLine(t))
      .map((text) => ({ file: "client/src/pages/Canary.tsx", line: 1, text }));
    expect(claimFindings(lines).some((f) => f.includes("claim.no-credit-check"))).toBe(true);
  });

  it("MUST NOT FLAG: honest copy, addresses, attributed provider lines, the searcher's question, and admin", () => {
    for (const ok of [
      "We have no interest in selling you parts you don't need.",
      "We have zero interest in upselling you.",
      "Most customers approve the estimate the same day.",
      "Estimates are approved by text in under 2 minutes.",
      "Most customers qualify for the military discount.",
      "Text YES to approve in 2 minutes.",
      "Approval is not guaranteed. Approval and same-day decisions are not guaranteed.",
      "Published approval amounts up to $7,500 for qualifying applicants",
      "Snap says applying won't affect your FICO score, though another consumer-report score may be.",
      "Snap says a decision may be available in seconds.",
      "Koalafi says this does not affect your FICO score.",
      "We don't run your credit card until you approve the work.",
      "A soft pull to the right usually means an alignment problem.",
      "You have 30 days from the date of purchase to complete the title transfer at a BMV office.",
      "If you disconnected the battery in the last 30 days, your car may not be ready for E-Check.",
      "Within the 90-day early purchase window, you pay less.",
      '<Link href="/no-credit-check-tires-cleveland">Bad credit? Tire options</Link>',
      "SEARCHING FOR NO CREDIT CHECK TIRES?\\nHERE'S THE STRAIGHT ANSWER.",
      "No Credit Check Tires Cleveland? Straight Answers | Nick's",
      "Can I get tires with no credit check?",
      "Never say 'no credit check' or promise approval.",
      "The state runs the test; we run a free readiness check and fix whatever is causing a failure.",
      "We'll run your E-Check readiness check while you wait.",
      "Only official E-Check stations run the state test.",
      "an EPA-certified converter",
      "GET LEGAL",
      "Ohio won't renew your registration until the vehicle passes E-Check or qualifies for a repair waiver or extension.",
    ]) {
      expect(scanOne(ok), ok).toEqual([]);
    }
    expect(scanOne("no credit check", "client/src/pages/admin/Canary.tsx")).toEqual([]);
  });
});

/* -- facts the claim rules cannot express ---------------------------------- */

/**
 * Same corpus, three facts that need numbers or names rather than phrases.
 *
 * USED-TIRE FLOOR. "$25" is real only on 12-inch rims (BUSINESS.usedTires), and
 * AGENTS.md requires the price to travel with that fine print. On 2026-10-01
 * about twenty-five customer lines said "from $25" with no rim size, including
 * the FAQ on thirty R16-R20 size pages, where it is never true.
 *
 * ADDRESS CITY. 58 lines said "17625 Euclid Ave, Euclid"; the postal city, the
 * Google listing and BUSINESS.address all say Cleveland.
 *
 * E-CHECK NUMBERS. The E-Check guide quoted a $19.50 fee, a 60-day free retest
 * and a $300 waiver; a blog post quoted $27.50. Ohio's numbers live in
 * shared/echeck.ts: three free tests in 365 days, then $18; a waiver needs more
 * than $450 since 2026-01-01.
 */
const FACT_SKIP = new Set([
  "shared/voice.ts",
  "shared/proof.ts",
  // an admin-only decision record that quotes the site's price on purpose
  "client/src/lib/opsRegistry.ts",
]);
const factFiles = new Map<string, Array<{ line: number; text: string }>>();
for (const l of CLAIM_LINES) {
  if (FACT_SKIP.has(l.file) || l.file.includes("/admin/")) continue;
  const list = factFiles.get(l.file) ?? [];
  list.push({ line: l.line, text: stripTags(decodeCopy(l.text)) });
  factFiles.set(l.file, list);
}

const RIM_FINEPRINT = /12[- ]?inch|12["\u201d]|12-in\b|fineprint/i;
const TYPICAL_BAND = /\$40\s*[-\u2013]\s*\$?80|typicalBand|explanation/i;
function usedFloorWithoutFineprint(file: string, list: Array<{ line: number; text: string }>): string[] {
  const out: string[] = [];
  let joined = "";
  const starts: number[] = [];
  for (const l of list) {
    starts.push(joined.length);
    joined += l.text.trim() + " ";
  }
  for (const m of joined.matchAll(/\$25\b/g)) {
    const at = m.index ?? 0;
    const before = joined.slice(Math.max(0, at - 40), at);
    const after = joined.slice(at, at + 200);
    // The used-tire floor, not "Plug repair from $25" or "mount-and-balance
    // starts at $25": "used" in the same clause just before, or "$25 used" after.
    // A template expression is not a sentence end: "Used ${page.size} tires ...".
    const clause = before.replace(/\$\{[^}]*\}/g, "X");
    // The price belongs to the list item it closes: in "New and used tires,
    // flat repair from $25" that is flat repair. A bare lead-in ("used tires,
    // from $25") prices the item before it.
    const items = clause.split(/[,;(\u2014]/);
    let item = items.pop() ?? "";
    while (items.length && /^\s*(?:(?:from|starting|starts?|at|just|only|as low as)\s*)*$/i.test(item)) item = items.pop() ?? "";
    const usedItem = /\bused\b[^.!?]*$/i.test(clause) && /\b(?:used|tires?)\b/i.test(item);
    if (!usedItem && !/^\$25\s+(?:installed\s+)?used\b/i.test(after)) continue;
    const near = before.slice(-80) + after;
    if (RIM_FINEPRINT.test(near) && TYPICAL_BAND.test(near)) continue;
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= at) i++;
    out.push(`${file}:${list[i].line} "${joined.slice(Math.max(0, at - 40), at + 40).trim()}"`);
  }
  return out;
}

// A comma after the street introduces the city; without one, only a city that
// runs straight into the state counts ("17625 Euclid Ave. Pull up" is a sentence).
/**
 * ACIMA "$10". client/src/lib/acima.ts says FTC Regulation M requires a
 * disclosure near every "$10", and shared/financing.ts says the $10 start is
 * Acima's, "available only in select circumstances". On 2026-10-01 about thirty
 * customer lines said "$10-down financing" or "$10 down via Snap/Acima/Koalafi",
 * where it is false for three of the four providers and carried no disclosure.
 * Every "$10" must name Acima nearby and carry the select-circumstances line
 * (or render a disclosure constant) within the next few hundred characters.
 */
function tenDollarWithoutDisclosure(file: string, list: Array<{ line: number; text: string }>): string[] {
  const out: string[] = [];
  let joined = "";
  const starts: number[] = [];
  for (const l of list) {
    starts.push(joined.length);
    joined += l.text.trim() + " ";
  }
  for (const m of joined.matchAll(/\$10(?![\d,.KkMm]|\/| to \$)/g)) {
    const at = m.index ?? 0;
    // Only the payment hook: "$10 down", "$10 initial payment", "$10-down
    // financing". "$10 to $30 for a gas cap" and "a $10 air filter" are parts.
    const context = joined.slice(Math.max(0, at - 40), at + 60);
    if (!/down|initial payment|lease|financ|payment program|acima|\bstart/i.test(context)) continue;
    const near = joined.slice(Math.max(0, at - 160), at + 400);
    const namesAcima = /acima/i.test(joined.slice(Math.max(0, at - 160), at + 160));
    const disclosed = /select circumstances|ACIMA_COMPACT_DISCLOSURE|acima\.disclosure/i.test(near);
    if (namesAcima && disclosed) continue;
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= at) i++;
    out.push(`${file}:${list[i].line} "${joined.slice(Math.max(0, at - 40), at + 40).trim()}"`);
  }
  return out;
}

const ADDRESS_CITY =
  /17625 Euclid Ave(?:nue)?(?:,\s*([A-Z][a-z]+)\b|\s+([A-Z][a-z]+)(?=,?\s+(?:OH|Ohio)\b))/g;
const cityOf = (m: RegExpMatchArray) => m[1] ?? m[2];
const STALE_ECHECK_NUMBERS =
  /\$(?:19\.50|27\.50)\b|\$300\b(?<!(?:was|from|it was) \$300\b)[^.\n]{0,80}\bwaiver|\bwaiver\b[^.\n]{0,80}(?<!was |from |it was )\$300\b/gi;

function factFindings(check: (file: string, list: Array<{ line: number; text: string }>) => string[]): string[] {
  return [...factFiles].flatMap(([file, list]) => check(file, list));
}

describe("facts the claim rules cannot express", () => {
  it("every used-tire '$25' carries the 12-inch fine print and the typical band", () => {
    expect(factFindings(usedFloorWithoutFineprint)).toEqual([]);
  });

  it("the used-tire matcher sees a bare floor and spares one with its fine print", () => {
    const at = (text: string) => usedFloorWithoutFineprint("x", [{ line: 1, text }]);
    expect(at("Used tires from $25 installed. Walk in 7 days.")).toHaveLength(1);
    expect(at("USED TIRES - FROM $25")).toHaveLength(1);
    expect(at("Used tires from $25 installed (12-inch rims; most sizes $40-80).")).toEqual([]);
    expect(at("Used tires from $25 installed (most sizes $40-80)")).toHaveLength(1);
    expect(at("used: ${USED.typicalBand}; from $25 on ${USED.fineprint}")).toEqual([]);
    expect(at("A $25 gift card with any purchase.")).toEqual([]);
    expect(at("We'll show you why before offering a used tire. Plug repair from $25.")).toEqual([]);
    expect(at("When a $25 used tire solves it, we don't push new.")).toHaveLength(1);
    expect(at("Used ${page.size} tires start around $25-60 each.")).toHaveLength(1);
    // The price belongs to the item it closes. Until 2026-10-01 this flat-repair
    // price was read as the used-tire floor, and a sweep gave it tire fine print.
    expect(at("New and used tires, flat repair from $25, brakes and alignment.")).toEqual([]);
    expect(at("Used tires, from $25 installed.")).toHaveLength(1);
    expect(at("New and used tires (used from $25 installed).")).toHaveLength(1);
  });

  it("no sentence states the used-tire band twice", () => {
    // A fine-print sweep that inserts "(select 12-inch; most $40-80)" next to a
    // band already there reads "most $40-80) on select sizes, most $40-80"; 37
    // neighborhood pages shipped that way in this PR's first draft.
    const twice = /\$40\s*[-\u2013]\s*\$?80[^.!?\n]{0,60}\$40\s*[-\u2013]\s*\$?80/;
    expect(twice.test("used from $25 installed (select 12-inch; most $40-80) on select sizes, most $40-80 — with")).toBe(true);
    expect(twice.test("used from $25 installed on select 12-inch rims, most $40-80. Most sizes $40-80.")).toBe(false);
    const found: string[] = [];
    for (const [file, list] of factFiles) {
      for (const l of list) if (twice.test(l.text)) found.push(`${file}:${l.line}`);
    }
    expect(found).toEqual([]);
  });

  it("every '$10' names Acima and carries its select-circumstances disclosure", () => {
    expect(factFindings(tenDollarWithoutDisclosure)).toEqual([]);
  });

  it("the $10 matcher sees a bare hook and spares the disclosed Acima line and fees", () => {
    const at = (text: string) => tenDollarWithoutDisclosure("x", [{ line: 1, text }]);
    expect(at("Stack any deal with $10-down financing.")).toHaveLength(1);
    expect(at("$10 down via Snap/Acima/Koalafi")).toHaveLength(1);
    expect(at("Acima lease-to-own can start at $10 in select circumstances.")).toEqual([]);
    expect(at("Tire balancing +$10/tire if needed.")).toEqual([]);
    expect(at("Sensor replacement is $100 to $250.")).toEqual([]);
    expect(at("Clean the mass airflow sensor: $10 for a can of MAF cleaner.")).toEqual([]);
    expect(at("Engine and cabin air filters are $10 to $25 each.")).toEqual([]);
  });

  it(`every '17625 Euclid Ave, <city>' names ${BUSINESS.address.city}`, () => {
    const wrong = factFindings((file, list) =>
      list.flatMap((l) =>
        [...l.text.matchAll(ADDRESS_CITY)]
          .filter((m) => cityOf(m) !== BUSINESS.address.city)
          .map((m) => `${file}:${l.line} "${m[0]}"`),
      ),
    );
    expect(wrong).toEqual([]);
  });

  it("the address matcher reads the city and ignores the street name", () => {
    const cities = (t: string) => [...t.matchAll(ADDRESS_CITY)].map(cityOf);
    expect(cities("17625 Euclid Ave, Euclid, OH 44112")).toEqual(["Euclid"]);
    expect(cities("17625 Euclid Ave, Cleveland, OH 44112")).toEqual(["Cleveland"]);
    expect(cities("17625 Euclid Ave Cleveland OH")).toEqual(["Cleveland"]);
    expect(cities("17625 Euclid Ave. Pull up any day.")).toEqual([]);
    expect(cities("17625 Euclid Ave, Euclid. Walk in.")).toEqual(["Euclid"]);
  });

  it("no E-Check fee or waiver figure contradicts shared/echeck.ts", () => {
    const stale = factFindings((file, list) =>
      list.flatMap((l) => [...l.text.matchAll(STALE_ECHECK_NUMBERS)].map((m) => `${file}:${l.line} "${m[0]}"`)),
    );
    expect(stale).toEqual([]);
  });

  it("the E-Check number matcher sees the stale figures and spares the history line", () => {
    const hits = (t: string) => [...t.matchAll(STALE_ECHECK_NUMBERS)].map((m) => m[0]);
    expect(hits("It costs $19.50 at any official E-Check station.")).toHaveLength(1);
    expect(hits("a valid form of payment ($27.50 for most vehicles)")).toHaveLength(1);
    expect(hits("if you spend at least $300 on emissions-related repairs, you may qualify for a waiver")).toHaveLength(1);
    expect(hits("Since January 1, 2026, a repair waiver requires more than $450 in emissions repairs (it was $300).")).toEqual([]);
  });

  it("no JSON-LD property asserts a credit or certification claim", () => {
    const props = factFindings((file, list) =>
      list
        .filter((l) => /name:\s*["'](?:\w*[Cc]redit[Cc]heck\w*|\w*[Cc]ertified\w*)["']/.test(l.text))
        .map((l) => `${file}:${l.line} ${l.text.trim()}`),
    );
    expect(props).toEqual([]);
  });
});
