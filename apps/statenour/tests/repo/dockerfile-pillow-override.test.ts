/**
 * The statenour runtime image forces Pillow 13.0.0 over moviepy's pin (2026-10-22).
 *
 * moviepy 2.2.1, the latest release, declares pillow<12, so pip resolves Pillow 11.3.0, which
 * carries 3 CRITICAL CVEs fixed only in 13.0.0 (container-scan "os layer" went red on #3223).
 * Nour chose forcing the new Pillow over accepting the CVEs. MoneyPrinter's 27 video tests and
 * a full subtitle render passed on 13.0.0 with moviepy 2.2.1 (PR body). The override must run
 * AFTER the moviepy install, or pip's resolver puts 11.x back.
 *
 * Removal condition: when moviepy is bumped, check whether the new release allows pillow>=13;
 * if it does, delete the override and this test. The moviepy pin is asserted so that a bump
 * fails here and forces that check instead of silently keeping a stale override.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCKERFILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../Dockerfile");

/**
 * The package arguments of every EXECUTED `pip install` in the runtime stage, in order. Comment
 * lines and inline ` # ...` comments are dropped, line continuations joined, and each RUN split
 * into its `&&` / `;` commands, so a mention (`RUN echo moviepy==2.2.1`, a comment) never counts
 * as an install. shortcut: a `#`, `&&` or `;` inside a quoted string would be mis-split; the
 * runtime stage has none, revisit if one is added.
 */
function pipInstalls(text: string): string[][] {
  const i = text.search(/^FROM .* AS runtime$/m);
  if (i < 0) return [];
  return text
    .slice(i)
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s#.*$/, ""))
    .join("\n")
    .replace(/\\\n/g, " ")
    .split(/\n|&&|;/)
    .map((c) => c.trim().replace(/^RUN\s+/, ""))
    .filter((c) => /^(python3? -m )?pip3? install\s/.test(c))
    .map((c) => c.split(/\s+/))
    .map((t) => t.slice(t.indexOf("install") + 1).filter((a) => !a.startsWith("-")));
}

const names = (pkgs: string[], name: string) =>
  pkgs.some((p) => new RegExp(`^${name}($|[=<>!~\\[;])`, "i").test(p));

/** True when the LAST install touching Pillow pins 13.0.0 and runs after the LAST moviepy install. */
function overrideHolds(installs: string[][]): boolean {
  const lastMoviepy = installs.findLastIndex((p) => names(p, "moviepy"));
  const lastPillow = installs.findLastIndex((p) => names(p, "pillow"));
  return lastMoviepy >= 0 && lastPillow > lastMoviepy && installs[lastPillow].includes("pillow==13.0.0");
}

/** True when an executed pip install pins exactly moviepy==2.2.1 (no suffixed release). */
const pinsMoviepy = (installs: string[][]) => installs.flat().includes("moviepy==2.2.1");

describe("statenour runtime image Pillow override", () => {
  const installs = pipInstalls(readFileSync(DOCKERFILE, "utf8"));

  it("the instrument finds the runtime stage's pip installs", () => {
    expect(installs.length).toBeGreaterThanOrEqual(2);
    expect(installs.flat()).toContain("edge-tts==7.2.7");
  });

  it("moviepy is still exactly 2.2.1 (a bump must re-check whether the override is still needed)", () => {
    expect(pinsMoviepy(installs)).toBe(true);
  });

  it("Pillow 13.0.0 is installed after moviepy, so the resolver cannot put 11.x back", () => {
    expect(overrideHolds(installs)).toBe(true);
  });

  it("the checks fail on every broken shape found in the PR #3224 review", () => {
    const stage = (body: string) => pipInstalls(`FROM node:24-alpine3.23 AS runtime\n${body}`);
    const active = "RUN pip install moviepy==2.2.1 \\\n && pip install pillow==13.0.0";
    expect(overrideHolds(stage(active))).toBe(true);
    expect(pinsMoviepy(stage(active))).toBe(true);
    const broken = {
      commented: "RUN pip install moviepy==2.2.1\n# RUN pip install pillow==13.0.0",
      before: "RUN pip install pillow==13.0.0\nRUN pip install moviepy==2.2.1",
      inline: "RUN pip install moviepy==2.2.1 \\\n && true # pip install pillow==13.0.0",
      reinstalled: `${active}\nRUN pip install moviepy==2.2.1`,
      downgraded: `${active}\nRUN pip install pillow==11.3.0`,
      moduleReinstall: `${active}\nRUN python3 -m pip install moviepy==2.2.1`,
      mentionOnly: "RUN echo moviepy==2.2.1 \\\n && pip install pillow==13.0.0",
    };
    for (const [shape, body] of Object.entries(broken)) {
      expect({ shape, holds: overrideHolds(stage(body)) }).toEqual({ shape, holds: false });
    }
    expect(pinsMoviepy(stage("RUN echo moviepy==2.2.1"))).toBe(false);
    expect(pinsMoviepy(stage("RUN pip install moviepy==2.2.1.post1"))).toBe(false);
  });
});
