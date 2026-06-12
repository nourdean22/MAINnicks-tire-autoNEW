/**
 * Compare live VAPI prompt vs the deploy-script source. Shows what
 * operator edited via the dashboard so we can decide what to keep.
 */
import "dotenv/config";

async function main() {
  const apiKey = process.env.VAPI_API_KEY;
  const r = await fetch("https://api.vapi.ai/assistant/150fe622-0b9f-4b03-b8c7-3063812717ae", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const live = await r.json() as Record<string, unknown>;
  const liveModel = live.model as Record<string, unknown> | undefined;
  const liveMessages = liveModel?.messages as Array<Record<string, unknown>> | undefined;
  const livePrompt = liveMessages?.[0]?.content as string | undefined;

  if (!livePrompt) { console.error("No live prompt"); process.exit(1); }

  // Source prompt
  const { ASSISTANT_SYSTEM_PROMPT } = await import("../../server/services/vapi");

  console.log(`Live prompt:    ${livePrompt.length} chars`);
  console.log(`Source prompt:  ${ASSISTANT_SYSTEM_PROMPT.length} chars`);
  console.log(`Delta:          ${livePrompt.length - ASSISTANT_SYSTEM_PROMPT.length} chars\n`);

  // Find passages in live that aren't in source (or are different)
  // Section-by-section split via "# ─── " headers
  const splitSections = (text: string): Record<string, string> => {
    const sections: Record<string, string> = {};
    const parts = text.split(/(# ─── \d+\.[^\n]*)/);
    let currentHeader = "PRELUDE";
    sections[currentHeader] = parts[0] || "";
    for (let i = 1; i < parts.length; i += 2) {
      currentHeader = parts[i].trim();
      sections[currentHeader] = parts[i + 1] || "";
    }
    return sections;
  };

  const liveSections = splitSections(livePrompt);
  const srcSections = splitSections(ASSISTANT_SYSTEM_PROMPT);

  const allHeaders = Array.from(new Set([...Object.keys(liveSections), ...Object.keys(srcSections)]));

  console.log("─── Section-level diff ───\n");
  for (const h of allHeaders) {
    const liveLen = (liveSections[h] || "").length;
    const srcLen = (srcSections[h] || "").length;
    if (liveLen === srcLen && liveSections[h] === srcSections[h]) continue; // identical
    const flag = !srcSections[h] ? "🟢 NEW (live only)" :
                 !liveSections[h] ? "🔴 GONE (source only)" :
                 "🟡 EDITED";
    console.log(`${flag}  ${h}`);
    console.log(`  live: ${liveLen}c  ·  source: ${srcLen}c`);

    // Show diff samples
    if (liveSections[h] && srcSections[h] && liveSections[h] !== srcSections[h]) {
      // Naive line-level diff
      const liveLines = (liveSections[h] || "").split("\n");
      const srcLines = (srcSections[h] || "").split("\n");
      const liveSet = new Set(liveLines);
      const srcSet = new Set(srcLines);
      const added = liveLines.filter(l => l.trim() && !srcSet.has(l));
      const removed = srcLines.filter(l => l.trim() && !liveSet.has(l));
      if (added.length > 0) {
        console.log(`  ADDED on live (${added.length} lines):`);
        for (const l of added.slice(0, 12)) console.log(`    + ${l.length > 130 ? l.slice(0, 130) + "..." : l}`);
        if (added.length > 12) console.log(`    + ... +${added.length - 12} more lines`);
      }
      if (removed.length > 0) {
        console.log(`  REMOVED on live (${removed.length} lines):`);
        for (const l of removed.slice(0, 12)) console.log(`    - ${l.length > 130 ? l.slice(0, 130) + "..." : l}`);
        if (removed.length > 12) console.log(`    - ... -${removed.length - 12} more lines`);
      }
    } else if (!srcSections[h]) {
      // Pure new section — print first 600c
      console.log("  Content sample:");
      console.log(`    ${(liveSections[h] || "").slice(0, 600).replace(/\n/g, "\n    ")}`);
    }
    console.log();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
