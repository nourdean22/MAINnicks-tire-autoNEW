/**
 * 2026-08-05 · The AmbientAura wrapper must never establish a containing
 * block for `position: fixed` descendants.
 *
 * THE LIVE DEFECT THIS PINS. The operator reported the /chat composer sitting
 * under the bottom tab bar ("theres an overlap at the bottom"). Nothing was
 * wrong with the reservation: BottomTabBar measures its real height into
 * --bottom-chrome-h via ResizeObserver, and the chat shell reserves exactly
 * that with pb-[var(--bottom-chrome-h)]. The math was right. The ANCHOR was
 * wrong.
 *
 * AmbientAura wraps every mastery page in
 *   <div class="state-aura state-aura-<state> min-h-screen">
 * and app/(mastery)/chat/page.tsx nests a `fixed inset-0` shell inside it,
 * documenting the assumption in its own comment: "A fixed child resolves
 * inset-0 against the viewport". That holds ONLY while no ancestor
 * establishes a containing block.
 *
 * .state-aura-drift carried `filter: saturate(0.72)`, which does establish
 * one. So inset-0 stopped meaning the viewport and started meaning the
 * wrapper's padding box — min-h-screen (100vh) plus .state-aura's 4px
 * padding — which runs past the visible fold on mobile. The composer rode
 * down with it while BottomTabBar, rendered OUTSIDE AmbientAura, stayed
 * correctly viewport-pinned and painted over it.
 *
 * detectState() returns "drift" on ANY unresolved drift alert and it is the
 * FIRST branch checked, so this was the common path, not a rare one.
 * .state-aura-low_energy carried the same filter; .state-aura-scattered
 * animated `transform: translateX`, which does the same thing for the life
 * of the animation.
 *
 * v10.0.474 already fixed this once by removing `position: relative`, and
 * effects.css carries three separate warning comments about the hazard — but
 * `position: relative` is only one of the doors. This test closes the rest,
 * including the keyframe path, which is where the scattered bug hid.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS_PATH = join(__dirname, "..", "app/styles/effects.css");

/**
 * Strip comments before scanning. The fix for this very bug documents the
 * forbidden property names in prose directly above the rules, so a guard that
 * cannot tell code from prose would flag its own documentation.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Pull `@keyframes NAME { ... }` out with a brace-balanced scan (nested braces). */
function extractKeyframes(css: string): { keyframes: Map<string, string>; rest: string } {
  const keyframes = new Map<string, string>();
  const rest: string[] = [];
  const re = /@(?:-\w+-)?keyframes\s+([\w-]+)\s*\{/g;
  let cursor = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(css)) !== null) {
    rest.push(css.slice(cursor, m.index));
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    keyframes.set(m[1], css.slice(re.lastIndex, i - 1));
    cursor = i;
    re.lastIndex = i;
  }
  rest.push(css.slice(cursor));
  return { keyframes, rest: rest.join("") };
}

/** Parse a declaration block into [property, value] pairs, lowercased. */
function declarations(body: string): Array<[string, string]> {
  return body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const idx = d.indexOf(":");
      if (idx === -1) return null;
      return [
        d.slice(0, idx).trim().toLowerCase(),
        d.slice(idx + 1).trim().toLowerCase(),
      ] as [string, string];
    })
    .filter((p): p is [string, string] => p !== null);
}

/**
 * Does this declaration make its element a containing block for fixed
 * descendants? Checks the PROPERTY, never the value — `.state-aura` sets
 * `transition: filter 800ms ease`, where "filter" is a value and is harmless.
 */
function containingBlockReason(prop: string, value: string): string | null {
  if (value === "none" || value === "initial" || value === "unset") return null;

  if (["transform", "translate", "rotate", "scale", "perspective"].includes(prop)) {
    return `${prop}: ${value}`;
  }
  if (prop === "filter" || prop === "backdrop-filter") {
    return `${prop}: ${value}`;
  }
  if (prop === "position" && ["relative", "absolute", "sticky", "fixed"].includes(value)) {
    return `position: ${value}`;
  }
  if (prop === "contain" && /\b(layout|paint|strict|content)\b/.test(value)) {
    return `contain: ${value}`;
  }
  if (
    prop === "will-change" &&
    /\b(transform|translate|rotate|scale|filter|backdrop-filter|perspective|position|contain)\b/.test(value)
  ) {
    return `will-change: ${value}`;
  }
  return null;
}

/** Every animation name a declaration block references. */
function animationNames(decls: Array<[string, string]>): string[] {
  const names: string[] = [];
  for (const [prop, value] of decls) {
    if (prop === "animation-name") {
      names.push(...value.split(",").map((v) => v.trim()));
    } else if (prop === "animation") {
      // shorthand: pull the token that isn't a time/keyword/count
      for (const part of value.split(",")) {
        const token = part
          .trim()
          .split(/\s+/)
          .find(
            (t) =>
              /^[a-z][\w-]*$/i.test(t) &&
              !/^(normal|reverse|alternate|alternate-reverse|none|forwards|backwards|both|running|paused|infinite|linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(t),
          );
        if (token) names.push(token);
      }
    }
  }
  return names;
}

describe("state-aura containing-block invariant", () => {
  const raw = readFileSync(CSS_PATH, "utf8");
  const css = stripComments(raw);
  const { keyframes, rest } = extractKeyframes(css);

  /**
   * Every ancestor of /chat's `fixed inset-0` shell, not just the aura.
   *
   * 2026-08-09 · WIDENED. The original guard only matched `.state-aura*`,
   * which is where the bug happened to land — but the shell's real ancestor
   * chain is:
   *
   *   body > .state-aura.min-h-screen > main#main-content > .feed.page-enter > .fixed
   *
   * A `filter` on `.feed` traps the shell exactly as thoroughly as one on the
   * aura, and `.page-enter` carries a hand-written "Do not add transform here"
   * warning with NO test behind it — a comment is not a gate. Guarding only the
   * selector that broke last time is fighting the previous war.
   */
  const GUARDED = /(^|[\s,>+~])(\.state-aura(-[\w]+)?|\.feed|\.page-enter|main)\b/;
  const auraRules = [...rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selector: m[1].trim(), body: m[2] }))
    .filter((r) => GUARDED.test(r.selector));

  it("finds the rules it is meant to guard", () => {
    // A guard that silently matches nothing always passes. Pin that the scan
    // reaches the aura states AND the rest of the shell's ancestor chain.
    const selectors = auraRules.map((r) => r.selector).join(" ");
    expect(auraRules.length).toBeGreaterThanOrEqual(5);
    for (const state of ["drift", "scattered", "low_energy", "on_fire", "normal"]) {
      expect(selectors).toContain(`.state-aura-${state}`);
    }
    // The widened surface — if these stop matching, the guard has silently
    // narrowed back to what it was before and the .feed/.page-enter hole reopens.
    expect(selectors, "the .feed ancestor is no longer covered").toContain(".feed");
    expect(selectors, "the .page-enter ancestor is no longer covered").toContain(".page-enter");
  });

  it("declares no property that traps fixed descendants", () => {
    const violations: string[] = [];
    for (const rule of auraRules) {
      for (const [prop, value] of declarations(rule.body)) {
        const reason = containingBlockReason(prop, value);
        if (reason) violations.push(`${rule.selector} { ${reason} }`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("animates no property that traps fixed descendants", () => {
    // Where the .state-aura-scattered bug hid: the rule itself was clean,
    // the keyframes it named animated transform: translateX().
    const violations: string[] = [];
    for (const rule of auraRules) {
      for (const name of animationNames(declarations(rule.body))) {
        const frames = keyframes.get(name);
        if (frames === undefined) continue;
        for (const step of frames.matchAll(/\{([^{}]*)\}/g)) {
          for (const [prop, value] of declarations(step[1])) {
            const reason = containingBlockReason(prop, value);
            if (reason) violations.push(`${rule.selector} -> @keyframes ${name} { ${reason} }`);
          }
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("resolves the keyframes the aura rules name", () => {
    // Guards the guard: if an animation name stops resolving (renamed
    // keyframes, shorthand parsed wrong), the check above would silently
    // skip it and pass while the trap sits in the animated properties.
    const named = auraRules.flatMap((r) => animationNames(declarations(r.body)));
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) {
      expect(keyframes.has(name), `@keyframes ${name} not found`).toBe(true);
    }
  });
});
