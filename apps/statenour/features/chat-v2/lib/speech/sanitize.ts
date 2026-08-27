/**
 * sanitizeForSpeech — deterministic markdown → speakable-prose pass.
 *
 * The failure mode this prevents: the engine reading
 * "asterisk asterisk Threat Level" or spelling out a URL. Rendered
 * markdown is for eyes; this produces what a person would SAY.
 *
 * Rules:
 *   · fenced code (closed or unclosed) → "Code block omitted."
 *   · inline code keeps its content (ordinary words are speakable)
 *   · links speak their label; bare URLs are dropped
 *   · headings/emphasis/blockquotes/bullets lose their syntax
 *   · table rows read as comma-separated cells; separator rows vanish
 *   · returns "" when nothing speakable remains (caller skips the span)
 *
 * Pure function — tested directly with synthetic fixtures.
 */

export function sanitizeForSpeech(raw: string): string {
  let text = raw;

  // Fenced code — closed blocks first, then a trailing unclosed fence
  // (the segmenter only emits one on flush).
  text = text.replace(/```[\s\S]*?```/g, " Code block omitted. ");
  text = text.replace(/```[\s\S]*$/g, " Code block omitted. ");

  // Images speak their alt text; links speak their label.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Footnote/citation artifacts.
  text = text.replace(/\[\^[^\]]*\]/g, "");
  text = text.replace(/【[^】]*】/g, "");

  // Bare URLs are noise when spoken.
  text = text.replace(/https?:\/\/\S+/g, " ");
  text = text.replace(/\bwww\.\S+/g, " ");

  // HTML tags and the common entities.
  text = text.replace(/<[^>\n]{1,120}>/g, " ");
  text = text.replace(/&amp;/g, " and ").replace(/&lt;|&gt;|&quot;|&#\d+;/g, " ");

  // Line-level syntax: headings, blockquotes, bullets, hrules, tables.
  text = text
    .split("\n")
    .map((line) => {
      let l = line;
      l = l.replace(/^\s{0,3}#{1,6}\s+/, "");            // headings
      l = l.replace(/^\s{0,3}(?:>\s?)+/, "");            // blockquotes (nested)
      l = l.replace(/^\s*[-*+]\s+/, "");                 // bullets
      l = l.replace(/^\s*(\d+)[.)]\s+/, "$1. ");         // ordered lists keep their number
      if (/^\s*[-_*]{3,}\s*$/.test(l)) return "";        // horizontal rules
      if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l)) return ""; // table separator rows
      if (l.includes("|")) {
        // table row → comma-joined cells
        const cells = l.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length > 1) l = cells.join(", ");
      }
      return l;
    })
    .join("\n");

  // Emphasis + inline code markers (content survives).
  text = text.replace(/(\*\*|__|~~)/g, "");
  text = text.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2");
  text = text.replace(/`([^`\n]*)`/g, "$1");

  // Whitespace collapse.
  text = text.replace(/\s+/g, " ").trim();
  return text;
}
