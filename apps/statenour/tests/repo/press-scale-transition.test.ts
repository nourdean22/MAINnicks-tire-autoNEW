/**
 * Wave B review: Tailwind 4 `active:scale-90` sets the CSS `scale` property, not `transform`. A
 * class that lists `transition-[color,background-color,transform]` beside it animates colour only,
 * so the press snaps with no ease (realtime-voice-overlay.tsx and reasoning-trace-modal.tsx did).
 * `transition-transform` is fine in Tailwind 4 (it lists transform, translate, scale and rotate);
 * only an explicit property list that names `transform` and not `scale` loses the ease.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/** Lines whose explicit transition list names `transform` but not `scale`, beside an `active:scale-` press. */
function brokenPressEase(source: string): number[] {
  return source.split("\n").flatMap((line, i) => {
    const list = /transition-\[([^\]]*)\]/.exec(line)?.[1];
    if (!list || !/active:scale-/.test(line)) return [];
    const props = list.split(",");
    return props.includes("transform") && !props.includes("scale") ? [i + 1] : [];
  });
}

describe("press scale keeps its ease under Tailwind 4", () => {
  it("POSITIVE CONTROL: the scanner flags the old class and passes the fix", () => {
    const old = 'className="a transition-[color,background-color,transform] active:scale-90"';
    expect(brokenPressEase(old)).toEqual([1]);
    expect(brokenPressEase(old.replace("transform", "scale"))).toEqual([]);
    expect(brokenPressEase('className="transition-transform active:scale-95"')).toEqual([]);
  });

  it("no component lists transform without scale beside an active:scale- press", () => {
    const files = [...walk("components"), ...walk("app"), ...walk("features")];
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((f) => brokenPressEase(readFileSync(f, "utf8")).map((n) => `${f}:${n}`));
    expect(hits).toEqual([]);
  });
});
