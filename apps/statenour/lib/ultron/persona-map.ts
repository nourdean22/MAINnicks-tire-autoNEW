/**
 * Ultron MODE → Nick persona prompt fragments
 *
 * When Ultron is in a given mode, Nick's voice shifts. Each mode has:
 *   - A short "voice" line shipped into the system prompt
 *   - A preferred AI profile (from lib/ai/profiles) for speed/tone
 *   - A one-line UI label for "how Nick is talking right now"
 *
 * The chat route already supports mode-override on inbound requests.
 * Ultron sends the current mode with every ask, so Nick replies in persona.
 */

import type { UltronMode } from "./mode-classifier";

export interface Persona {
  voice: string;          // appended to system prompt
  label: string;          // UI label under NickInput ("sniper instructor", etc.)
  profileHint: string;    // AI profile preference — caller picks
  replyCap: number;       // max tokens for quick-mode replies
}

export const PERSONA_BY_MODE: Record<UltronMode, Persona> = {
  BATTLE: {
    voice:
      "You are in BATTLE persona. Cut the wind-up. Tell Nour the one thing to hit first and why. No motivation, no summary — just the next move. Under 3 sentences.",
    label: "sniper instructor",
    profileHint: "venice-fast",
    replyCap: 160,
  },
  SURGICAL: {
    voice:
      "You are in SURGICAL persona. Nour is in flow. Protect it. Offer minimal input — only surface what amplifies or blocks the current focus. Refuse tangents. Under 3 sentences.",
    label: "flow coach",
    profileHint: "venice-fast",
    replyCap: 140,
  },
  RECOVERY: {
    voice:
      "You are in RECOVERY persona. Nour is drifting. Don't lecture. Offer one small physical act (water, breath, short walk) and one tiny win he can grab. Warm but brief. Under 4 sentences.",
    label: "discipline teacher",
    profileHint: "venice-smart",
    replyCap: 200,
  },
  SHUTDOWN: {
    voice:
      "You are in SHUTDOWN persona. Evening ritual. Guide Nour through closing the day — score, one honest reflection, tomorrow's MIT. No big decisions. No new commitments. Calm, short sentences.",
    label: "shutdown guide",
    profileHint: "venice-smart",
    replyCap: 240,
  },
  NORMAL: {
    voice:
      "You are in NORMAL persona. Nour is in standard operating mode. Answer cleanly and concisely. Default tone: direct, respectful, zero fluff.",
    label: "operator",
    profileHint: "venice-fast",
    replyCap: 220,
  },
};

export function personaFor(mode: UltronMode): Persona {
  return PERSONA_BY_MODE[mode];
}

/**
 * Lightweight greeting fragment shown in the omni-capture placeholder.
 * Shifts by mode so Nour feels the system's attention state.
 */
export function capturePlaceholderFor(mode: UltronMode): string {
  // Apr 18 — slash-prefix list retired from placeholders. The
  // IntentChip above the input now shows predicted intent in real
  // time (tap to cycle). Prefixes still work silently for power-user
  // muscle memory. See lib/ultron/omni-capture-router.ts.
  switch (mode) {
    case "BATTLE":   return "what's the move…";
    case "SURGICAL": return "protect the flow…";
    case "RECOVERY": return "one small thing…";
    case "SHUTDOWN": return "close the day…";
    case "NORMAL":   return "capture…";
  }
}
