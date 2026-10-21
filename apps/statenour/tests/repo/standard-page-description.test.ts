/**
 * UI v3 W1a review round 2, item 2: a description that carries a live value is visible at every width.
 *
 * The header diet hides the StandardPage description below md. Four pages put state there (version and
 * last refresh, mood counters, pin count, new-since count) and nowhere else on the phone. Rule: a
 * `description={...}` whose expression is not a plain string must come with descriptionVisibility="always".
 * Static copy keeps the md-up default. No allowlist.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "api" || name === "node_modules") continue;
    if (statSync(full).isDirectory()) pages(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

/** StandardPage openings whose description is a non-string expression and that lack descriptionVisibility="always". */
export function liveDescriptionsWithoutAlways(src: string, name = "x.tsx"): string[] {
  const sf = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  (function visit(n: ts.Node) {
    if (ts.isJsxOpeningLikeElement(n) && n.tagName.getText(sf) === "StandardPage") {
      const attrs = n.attributes.properties.filter(ts.isJsxAttribute);
      const by = (k: string) => attrs.find((a) => ts.isIdentifier(a.name) && a.name.text === k);
      const d = by("description");
      const init = d?.initializer;
      const isLive =
        !!init && ts.isJsxExpression(init) && !!init.expression && !ts.isStringLiteral(init.expression) && !ts.isNoSubstitutionTemplateLiteral(init.expression);
      if (isLive) {
        const v = by("descriptionVisibility")?.initializer;
        const always = !!v && ts.isStringLiteral(v) && v.text === "always";
        if (!always) out.push(`${name}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
      }
    }
    ts.forEachChild(n, visit);
  })(sf);
  return out;
}

describe("StandardPage descriptions with live values stay visible at every width", () => {
  it("positive control: the scan flags a live description without always and accepts one with it", () => {
    expect(liveDescriptionsWithoutAlways('<StandardPage eyebrow="a" title="T" description={`v${v}`} />')).toEqual(["x.tsx:1"]);
    expect(liveDescriptionsWithoutAlways('<StandardPage eyebrow="a" title="T" description={count + " pins"} />')).toEqual(["x.tsx:1"]);
    expect(liveDescriptionsWithoutAlways('<StandardPage eyebrow="a" title="T" description={`v${v}`} descriptionVisibility="always" />')).toEqual([]);
    expect(liveDescriptionsWithoutAlways('<StandardPage eyebrow="a" title="T" description="static copy" />')).toEqual([]);
    expect(liveDescriptionsWithoutAlways('<StandardPage eyebrow="a" title="T" description={"static copy"} />')).toEqual([]);
  });

  it("every app page passes", () => {
    const files = pages(join(ROOT, "app"));
    expect(files.length).toBeGreaterThan(10);
    const bad = files.flatMap((f) => liveDescriptionsWithoutAlways(readFileSync(f, "utf8"), relative(ROOT, f).replace(/\\/g, "/")));
    expect(bad).toEqual([]);
  });
});
