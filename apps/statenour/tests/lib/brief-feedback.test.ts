/**
 * UI v3 W2 (2026-10-16): Keep / Less on the Home brief is device-local. The store is a pure module
 * over a localStorage-shaped interface, so the 7-day expiry and the corrupt-value paths are pinned
 * without a browser.
 */
import { describe, expect, it } from "vitest";

import {
  BRIEF_FEEDBACK_KEY,
  BRIEF_LESS_TTL_MS,
  hiddenKinds,
  readBriefFeedback,
  writeBriefVerdict,
} from "@/lib/ui/brief-feedback";

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    dump: () => Object.fromEntries(m),
  };
}

const NOW = Date.parse("2026-10-16T12:00:00.000Z");

describe("brief feedback store", () => {
  it("the key is the spelled one and the TTL is seven days", () => {
    expect(BRIEF_FEEDBACK_KEY).toBe("nour:brief-feedback");
    expect(BRIEF_LESS_TTL_MS).toBe(7 * 86_400_000);
  });

  it("Less on a kind hides that kind for seven days, then stops hiding it", () => {
    const s = memoryStorage();
    writeBriefVerdict(s, "followup", "less", NOW);
    expect(hiddenKinds(readBriefFeedback(s), NOW)).toEqual(["followup"]);
    expect(hiddenKinds(readBriefFeedback(s), NOW + BRIEF_LESS_TTL_MS - 1)).toEqual(["followup"]);
    expect(hiddenKinds(readBriefFeedback(s), NOW + BRIEF_LESS_TTL_MS)).toEqual([]);
  });

  it("Keep clears a Less and is recorded with its time", () => {
    const s = memoryStorage();
    writeBriefVerdict(s, "horizon", "less", NOW);
    writeBriefVerdict(s, "horizon", "keep", NOW + 1000);
    const map = readBriefFeedback(s);
    expect(map.horizon).toEqual({ verdict: "keep", at: NOW + 1000 });
    expect(hiddenKinds(map, NOW + 2000)).toEqual([]);
  });

  it("the stored shape is {kind -> {verdict, at}} under the one key, and other kinds survive a write", () => {
    const s = memoryStorage();
    writeBriefVerdict(s, "approval", "less", NOW);
    writeBriefVerdict(s, "commitment", "keep", NOW);
    expect(JSON.parse(s.dump()[BRIEF_FEEDBACK_KEY])).toEqual({
      approval: { verdict: "less", at: NOW },
      commitment: { verdict: "keep", at: NOW },
    });
  });

  it("a corrupt, foreign or missing value reads as empty, never throws, and never hides anything", () => {
    for (const raw of ["not json", "[]", "null", '{"lead":"less"}', '{"lead":{"verdict":"maybe","at":1}}', '{"lead":{"verdict":"less","at":"x"}}']) {
      const map = readBriefFeedback(memoryStorage({ [BRIEF_FEEDBACK_KEY]: raw }));
      expect(map, raw).toEqual({});
      expect(hiddenKinds(map, NOW), raw).toEqual([]);
    }
    expect(readBriefFeedback(memoryStorage())).toEqual({});
  });

  it("a storage that throws (private mode, quota) is a no-op read and write", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readBriefFeedback(broken)).toEqual({});
    expect(() => writeBriefVerdict(broken, "lead", "less", NOW)).not.toThrow();
  });
});
