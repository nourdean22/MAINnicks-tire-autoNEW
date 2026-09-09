#!/usr/bin/env node
/**
 * extract-runtime-oslayer — emit ONLY a Dockerfile's final-stage OS layer.
 *
 * WHY THIS EXISTS. Dependabot reads manifests. It cannot see inside a built
 * image, and these two images carry three package ecosystems it never looks at:
 *
 *   · apk — `chromium nss freetype harfbuzz ca-certificates` (worker) and
 *     `python3 ffmpeg imagemagick py3-pip` (statenour). ImageMagick and
 *     Chromium are two of the highest-CVE-volume packages in existence.
 *   · pip — 14 version-pinned packages in statenour's runtime (`yt-dlp`,
 *     `litellm`, `requests`, `fastapi`…). `dependabot.yml` declares `npm` and
 *     `github-actions` only, so NOTHING watches these.
 *   · the flattened node_modules copied into the final image.
 *
 * WHY NOT JUST BUILD THE IMAGE. The real image needs the whole app build —
 * four workspace package builds plus `next build` — which is slow and can fail
 * for reasons that have nothing to do with security. A scan that goes red
 * because a Next.js build wanted an env var teaches everyone to ignore it.
 * The OS layer is the part Dependabot is blind to, and it is reachable
 * without compiling a single line of app code.
 *
 * WHY NOT HAND-COPY THE apk LINES INTO A SCAN FIXTURE. That is a second copy
 * of the package list, which drifts the moment someone adds a package — the
 * exact defect class this repo keeps finding. This DERIVES the layer from the
 * real Dockerfile every run, so it cannot disagree with what ships.
 *
 * It takes the LAST `FROM` (the final image by Dockerfile convention) and
 * keeps its `FROM` + `RUN` instructions up to the first `COPY --from=` /
 * `ADD --from=` — i.e. everything that installs OS or language packages,
 * and nothing that needs a build stage to exist.
 *
 * Refuses to emit a stage with no RUN instructions: a bare base image would
 * scan clean and look like good news.
 *
 * Usage:
 *   node scripts/extract-runtime-oslayer.mjs apps/worker/Dockerfile > /tmp/os.Dockerfile
 */
import { readFileSync } from "node:fs";

/**
 * Split a Dockerfile into logical instructions, honouring `\` continuations.
 * A naive line-by-line reader sees `RUN apk add --no-cache \` as a complete
 * instruction and silently drops every package on the following lines.
 */
export function parseInstructions(text) {
  const out = [];
  let buf = null;

  for (const line of text.split(/\r?\n/)) {
    if (buf === null) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      buf = [line];
    } else {
      buf.push(line);
    }
    if (!buf[buf.length - 1].trimEnd().endsWith("\\")) {
      const joined = buf.join("\n");
      out.push({ keyword: (/^\s*([A-Za-z]+)/.exec(joined)?.[1] ?? "").toUpperCase(), text: joined });
      buf = null;
    }
  }
  if (buf) {
    const joined = buf.join("\n");
    out.push({ keyword: (/^\s*([A-Za-z]+)/.exec(joined)?.[1] ?? "").toUpperCase(), text: joined });
  }
  return out;
}

/** The final stage's OS layer, as a standalone buildable Dockerfile. */
export function runtimeOsLayer(dockerfileText) {
  const ins = parseInstructions(dockerfileText);

  let start = -1;
  for (let i = 0; i < ins.length; i++) if (ins[i].keyword === "FROM") start = i;
  if (start < 0) throw new Error("no FROM instruction found");

  const kept = [];
  for (let i = start; i < ins.length; i++) {
    const { keyword, text } = ins[i];
    if (i > start && (keyword === "COPY" || keyword === "ADD") && /--from=/.test(text)) break;
    // A second FROM cannot appear (we started at the last one), but stopping is
    // the safe reading if the file is ever restructured.
    if (i > start && keyword === "FROM") break;
    if (keyword === "FROM") kept.push(text.replace(/\s+AS\s+\S+\s*$/i, ""));
    else if (keyword === "RUN") kept.push(text);
  }

  if (!kept.some((l) => /^\s*RUN\b/i.test(l))) {
    throw new Error(
      "final stage installs nothing — refusing to emit a bare base image, which would scan clean and read as good news",
    );
  }
  return kept.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, "/") || process.argv[1]?.endsWith("extract-runtime-oslayer.mjs")) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/extract-runtime-oslayer.mjs <Dockerfile>");
    process.exit(2);
  }
  process.stdout.write(runtimeOsLayer(readFileSync(path, "utf8")));
}
