const TRUE_PATTERNS = [
  /\bstitch\b/i,
  /\benhance\b.*\bprompt\b/i,
  /\bimprove\b.*\bprompt\b/i,
  /\bpolish\b.*\bprompt\b/i,
  /\b(?:landing\s+page|dashboard|mobile\s+screen|web\s+app|login|booking)(?:\s+[a-zA-Z]+)?\s+prompt\b/i,
  /\bdesign\s+system\s+prompt\b/i,
  /\bturn\s+this\s+into\s+a\s+stitch\s+prompt\b/i,
  /\bmake\s+this\s+better\s+for\s+(?:ui|stitch)\s+generation\b/i,
  /\bfigma-like\s+ui\s+generation\b/i,
  /\bcomponent\s+layout\s+prompt\b/i,
  /\bdesign\s+(?:a\s+)?(?:mobile|dashboard|landing|login|booking)(?:\s+[a-zA-Z]+)?\s+(?:screen|page|ui|layout)\b/i,
  /\bui\s+layout\s+prompt\b/i
];

const FALSE_PATTERNS = [
  /\binstagram\b/i,
  /\bsms\b/i,
  /\bcaption\b/i,
  /\btypescript\b/i,
  /\berror\b/i,
  /\bbug\b/i,
  /\btax(?:es)?\b/i,
  /\bhealth\b/i,
  /\bworkout\b/i
];

export function detectStitchPromptIntent(message: string): boolean {
  if (!message || typeof message !== "string") return false;
  
  const hasTrueSignal = TRUE_PATTERNS.some(pat => pat.test(message));
  if (!hasTrueSignal) return false;
  
  const hasFalseSignal = FALSE_PATTERNS.some(pat => pat.test(message));
  // If it contains false signals but also explicitly overrides with "Stitch" or "UI prompt", let it pass.
  if (hasFalseSignal) {
    const override = /\bstitch\b/i.test(message) || /\bui\s+prompt\b/i.test(message);
    if (!override) return false;
  }
  
  return true;
}
