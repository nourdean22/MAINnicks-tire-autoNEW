/**
 * Utilities for interacting with prompt templates containing {locked} core blocks and [editable] user fields.
 */

export interface ParseResult {
  lockedBlocks: string[];
  editableBlocks: string[];
}

export function detectLockedBlocks(promptText: string): string[] {
  const matches = promptText.match(/\{[^}]+\}/g);
  return matches ? matches.map((m) => m.slice(1, -1)) : [];
}

export function detectEditableBlocks(promptText: string): string[] {
  const matches = promptText.match(/\[[^\]]+\]/g);
  return matches ? matches.map((m) => m.slice(1, -1)) : [];
}

export function compareLockedBlocks(originalPrompt: string, modifiedPrompt: string): { changed: boolean; diff?: string } {
  const originalBlocks = detectLockedBlocks(originalPrompt);
  const modifiedBlocks = detectLockedBlocks(modifiedPrompt);

  if (originalBlocks.length !== modifiedBlocks.length) {
    return { changed: true, diff: "Locked block count mismatch" };
  }

  for (let i = 0; i < originalBlocks.length; i++) {
    if (originalBlocks[i] !== modifiedBlocks[i]) {
      return { changed: true, diff: `Block at index ${i} changed from "${originalBlocks[i]}" to "${modifiedBlocks[i]}"` };
    }
  }

  return { changed: false };
}

export function assertLockedCoreUnchanged(originalPrompt: string, modifiedPrompt: string): void {
  const result = compareLockedBlocks(originalPrompt, modifiedPrompt);
  if (result.changed) {
    throw new Error(`Locked core mutation detected: ${result.diff}`);
  }
}

export function rewriteEditableFieldsOnly(originalPrompt: string, replacements: Record<string, string>): string {
  let result = originalPrompt;
  const editableBlocks = detectEditableBlocks(originalPrompt);

  for (const block of editableBlocks) {
    if (replacements[block] !== undefined) {
      // Escape for regex
      const safeBlock = block.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\[${safeBlock}\\]`, "g");
      result = result.replace(regex, replacements[block]);
    }
  }

  return result;
}

export function validatePromptProductTemplate(promptText: string): boolean {
  let braces = 0;
  let brackets = 0;
  for (const char of promptText) {
    if (char === "{") braces++;
    if (char === "}") braces--;
    if (char === "[") brackets++;
    if (char === "]") brackets--;
    if (braces < 0 || brackets < 0) return false;
  }
  return braces === 0 && brackets === 0;
}
