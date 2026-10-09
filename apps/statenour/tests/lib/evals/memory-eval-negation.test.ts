/**
 * Forbidden-claim negation scoping (2026-10-09).
 *
 * Defect (autoresearch audit ledger P5 / open item 8): the old forbiddenAsClaim
 * cleared a forbidden term whenever ANY negator appeared ANYWHERE in the answer,
 * so "Deploys run on Vercel. We no longer use Netlify." passed with forbidden
 * "vercel" because "no longer" sat in a different sentence. Negation is now
 * scoped per occurrence and per clause: a negator within NEGATION_WINDOW_TOKENS
 * tokens before the term, a retirement verb whose direct object is the term, or
 * a retirement / not-in-use predicate directly after it (full list in the
 * runner's header comment).
 *
 * Positive control: `legacyForbiddenAsClaim` below is a verbatim copy of the
 * pre-2026-10-09 rule. Every planted cross-sentence case must FOOL it (return
 * false = masked) and be CAUGHT by the shipped rule - otherwise the planted case
 * does not discriminate and a green here proves nothing.
 *
 * Review round 2 (same day): two reviewers probed the first scoped rule and
 * found 40+ sentences that ASSERT the term yet read as negated (a negated verb
 * after the term, a comma-joined clause, a cue about another noun, a sentence
 * that ends in `.)` or `.**`). Every sentence in the `roundTwoClaims` tables
 * below returned false (masked) against that rule: this file was run against it
 * before the fix and every one of them was red. They are the positive
 * control for round 2. The "true negations" tables are the other direction:
 * shapes the tightened rule must still clear.
 *
 * Review round 3 (same day): a third review found future/modal/progressive
 * retirements ("will be retired", "is being retired"), reassertions after
 * and/yet/comma and inside a label, "previously migrated to X", questions and
 * hedges ("Is Vercel retired? No.", "almost dropped Vercel") all read as
 * negated, and the plainest correct answers on the dataset's own terms ("The
 * statenour-master branch is retired") read as claims. Every sentence in
 * `roundThreeClaims` returned false (masked) and every sentence in
 * `roundThreeNegations` returned true (claim) against the round-2 rule: a probe
 * of exactly these 40 sentences ran before the fix and all 40 were wrong. The
 * "round 3 guards" block pins each new guard in both directions; a mutation
 * sweep confirmed each of those rows fails when its guard is removed.
 */
import { describe, it, expect } from "vitest";
import { MEMORY_EVALS } from "../../../lib/evals/memory-evals";
import {
  forbiddenAsClaim,
  gradeAnswer,
  gradeDoc,
  validateDataset,
  NEGATION_WINDOW_TOKENS,
} from "../../../lib/evals/memory-eval-runner";
import type { MemoryEval } from "../../../lib/evals/memory-eval-types";

/** The pre-2026-10-09 rule, copied verbatim. Used ONLY as the broken instrument. */
const LEGACY_NEGATORS = [
  "retired", "not ", "no longer", "never", "isn't", "is not",
  "instead of", "deprecated", "former", "used to", "was ",
];
function legacyForbiddenAsClaim(text: string, term: string): boolean {
  const hay = text.toLowerCase();
  if (!hay.includes(term.toLowerCase())) return false;
  return !LEGACY_NEGATORS.some((n) => hay.includes(n));
}

const vercelEval: MemoryEval = {
  id: "t-vercel",
  category: "deployment_truth",
  question: "Where does it deploy?",
  expectedFacts: ["railway"],
  forbiddenClaims: ["vercel"],
  severity: "critical",
  sourceHints: ["test"],
};

describe("forbiddenAsClaim - the audited defect", () => {
  const defect = "Deploys run on Vercel. We no longer use Netlify.";

  it("positive control: the legacy rule is fooled by the cross-sentence negator", () => {
    expect(legacyForbiddenAsClaim(defect, "vercel")).toBe(false); // masked = the bug
  });

  it("the shipped rule catches it", () => {
    expect(forbiddenAsClaim(defect, "vercel")).toBe(true);
  });

  it("gradeAnswer now fails the answer and names the term", () => {
    const r = gradeAnswer(vercelEval, `Railway is the host. ${defect}`);
    expect(r.status).toBe("fail");
    expect(r.presentForbidden).toEqual(["vercel"]);
  });
});

describe("forbiddenAsClaim - true negations still pass (named, not claimed)", () => {
  const negated: Array<[string, string]> = [
    ["Vercel is retired.", "post: copula + retirement word"],
    ["Vercel was retired last year.", "post: past passive + adverbial"],
    ["Vercel has since been deprecated.", "post: aux/adverb chain"],
    ["Vercel was replaced by Railway.", "post: replaced by"],
    ["Vercel was removed in 2025.", "post: was removed"],
    ["Vercel is no longer used.", "post: no longer used"],
    ["Vercel is not used.", "post: negation"],
    ["Vercel (deprecated) was the old host.", "post: parenthetical"],
    ["Vercel was shut down.", "post: phrasal retirement"],
    ["Vercel and Netlify are retired.", "post: coordinated subject"],
    ["Both Vercel and Netlify are retired.", "post: coordinated subject after 'both'"],
    ["We no longer deploy to Vercel.", "pre: no longer"],
    ["It deploys via Railway, not Vercel.", "pre: adjacent not across a comma"],
    ["Production does not run on the Vercel platform.", "pre: not at distance 4"],
    ["We stopped using Vercel.", "pre: stopped"],
    ["Railway is used instead of Vercel.", "pre: instead of"],
    ["Neither Netlify nor Vercel is used.", "pre: nor, term as subject"],
    ["We replaced Vercel with Railway.", "pre: retirement verb, term is its object"],
    ["The former Vercel deploy is gone.", "pre: historical marker"],
    ["It used to deploy to Vercel.", "pre: used to"],
    ["There is no Vercel deploy anymore.", "pre: no"],
  ];
  for (const [text, why] of negated) {
    it(`${why}: "${text}"`, () => {
      expect(forbiddenAsClaim(text, "vercel")).toBe(false);
    });
  }

  it("the last item of an object list takes the cue of the first", () => {
    const real = "We no longer use codex/ollama-local or statenour-master.";
    expect(forbiddenAsClaim(real, "codex/ollama-local")).toBe(false);
    expect(forbiddenAsClaim(real, "statenour-master")).toBe(false);
    expect(forbiddenAsClaim("We retired codex/ollama-local and statenour-master.", "statenour-master")).toBe(false);
    expect(forbiddenAsClaim("We stopped using Netlify and Vercel.", "vercel")).toBe(false);
    expect(forbiddenAsClaim("Railway replaced Netlify and Vercel.", "vercel")).toBe(false);
  });

  it("a three-item retirement list clears every item", () => {
    const text = "Vercel, codex/ollama-local and statenour-master are all retired.";
    for (const term of ["vercel", "codex/ollama-local", "statenour-master"]) {
      expect(forbiddenAsClaim(text, term)).toBe(false);
    }
  });
});

describe("forbiddenAsClaim - claims are caught", () => {
  const claimed: Array<[string, string]> = [
    ["It deploys to Vercel.", "plain assertion"],
    ["Deploys run on Vercel; we no longer use Netlify.", "semicolon splits the clause"],
    // The next four put the negator within K tokens of the term, separated ONLY
    // by a sentence boundary, so they fail if sentence scoping is removed.
    ["Netlify is not used. Vercel hosts prod.", "negator in the previous sentence, in range"],
    ["Production runs on Vercel. Not Netlify.", "negator opens the next sentence"],
    ["We never use it\nVercel hosts prod", "newline splits the sentence"],
    ["Deploys run on Vercel; not Netlify.", "semicolon blocks the post window"],
    ["We do not use Netlify but Vercel hosts prod.", "contrastive break cuts the window"],
    ["Everything else is retired except Vercel.", "except cuts the window"],
    ["It is not only on Vercel but also on Railway.", "not only ... but is a claim"],
    ["No, it deploys to Vercel.", "interjection no, is not a negator"],
    ["Heroku is retired and Vercel is primary.", "negator belongs to the other clause's subject"],
    ["Heroku is retired and Vercel hosts prod.", "predicative retired belongs to Heroku"],
    ["We do not use Netlify, and Vercel is the host.", "term is the subject of its own clause"],
    ["Vercel is live and Heroku was retired.", "retirement predicate belongs to Heroku"],
    ["Vercel is active, not retired.", "post: negation attached to a different word"],
    ["Vercel is not retired.", "double negation asserts the term"],
    ["Vercel without the CDN still hosts prod.", "post: 'without' modifies a noun, not the predicate"],
    ["Vercel deprecated their old API.", "active transitive verb, Vercel is live"],
    ["Vercel replaced Railway.", "active transitive verb with a bare object"],
    ["Vercel's dropped its free tier.", "'s = has, active verb with a determiner object"],
    ["We replaced Netlify with Vercel.", "Vercel is the replacement, not the retiree"],
    ["Netlify was replaced by Vercel.", "Vercel is the replacement (passive)"],
    ["Unlike Vercel, Netlify is retired.", "comma is not a list without and/or"],
    ["Vercel is retired. Actually it still deploys to Vercel.", "a later occurrence re-asserts"],
    ["We no longer use Netlify and deploy on Vercel.", "negator outside the window"],
    // Pinned as known false PASSes in round 1; fixed in round 2.
    ["Netlify isn't used and Vercel hosts prod.", "an and-clause with its own verb ends the negation"],
    ["We never stopped using Vercel.", "double negation in the pre-window is a claim"],
    ["We did not stop using Vercel.", "double negation with a base-form verb"],
    ["We haven't retired Vercel.", "a negated retirement verb is a claim"],
    // Guards the round-2 "switched from" cue: Vercel is the destination, not the object.
    ["We switched from Netlify to Vercel.", "switched from names the OLD host"],
    ["Nothing replaced Vercel.", "a negative subject before a retirement verb"],
    ["Nobody has retired Vercel.", "a negative subject before a retirement verb"],
    ["Nothing beats Vercel.", "a negative subject alone is not a negator"],
    ["We retired Netlify and Vercel hosts prod.", "an and-clause is not an object list"],
    ["Railway replaced Netlify with Heroku and Vercel.", "list items after 'with' are the replacements"],
    ["Formerly Netlify now Vercel.", "a present marker cancels a historical adverb"],
    ["We're used to Vercel.", "'used to' + noun means accustomed, not past use"],
    ["Prod runs on Vercel and the old servers are retired.", "a subject list needs the term to open its clause"],
    // A bracket or em dash ends the pre-window: without that break "not" sits in range.
    ["We do not use Netlify (Vercel hosts prod).", "an opening bracket ends the pre-window"],
    ["We do not use Netlify \u2014 Vercel hosts prod.", "an em dash ends the pre-window"],
  ];
  for (const [text, why] of claimed) {
    it(`${why}: "${text}"`, () => {
      expect(forbiddenAsClaim(text, "vercel")).toBe(true);
    });
  }

  it("absent term is never a claim", () => {
    expect(forbiddenAsClaim("Railway hosts production.", "vercel")).toBe(false);
  });

  it("matching is case-insensitive and tolerates curly apostrophes", () => {
    expect(forbiddenAsClaim("VERCEL HOSTS IT.", "Vercel")).toBe(true);
    expect(forbiddenAsClaim("Vercel isn\u2019t used.", "vercel")).toBe(false);
  });
});

describe("forbiddenAsClaim - the window is K tokens, exactly", () => {
  const FILLER = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"];
  const at = (distance: number) => `We do not ${FILLER.slice(0, distance - 1).join(" ")} Vercel`;

  it(`K is ${NEGATION_WINDOW_TOKENS}`, () => {
    expect(NEGATION_WINDOW_TOKENS).toBe(4);
  });

  it("a negator exactly K tokens before the term negates it", () => {
    expect(forbiddenAsClaim(at(NEGATION_WINDOW_TOKENS), "vercel")).toBe(false);
  });

  it("a negator K+1 tokens before the term does not", () => {
    expect(forbiddenAsClaim(at(NEGATION_WINDOW_TOKENS + 1), "vercel")).toBe(true);
  });

  // Round 1 let the window cross commas ("commas do not count"). Round 2 ends the
  // pre-window at a comma, because a comma-joined clause hid claims such as
  // "Netlify is not used, it deploys to Vercel". A negator AFTER the comma still
  // works; a list after a comma is pinned below as a known false FAIL.
  it("a comma ends the pre-window", () => {
    expect(forbiddenAsClaim("We do not use alpha, bravo, Vercel", "vercel")).toBe(true);
    expect(forbiddenAsClaim("It deploys via Railway, not Vercel.", "vercel")).toBe(false);
  });

  it("and/or inside the window still negates a list item that ends its clause", () => {
    expect(forbiddenAsClaim("We do not use Netlify or Vercel.", "vercel")).toBe(false);
    expect(forbiddenAsClaim("We do not use Netlify or Vercel anymore.", "vercel")).toBe(false);
  });
});

describe("forbiddenAsClaim - every real forbidden claim in MEMORY_EVALS", () => {
  const terms = [...new Set(MEMORY_EVALS.flatMap((e) => e.forbiddenClaims))];

  it("the dataset has forbidden claims to sweep (instrument sees a target)", () => {
    expect(terms.length).toBeGreaterThanOrEqual(8);
  });

  for (const term of terms) {
    it(`"${term}": cross-sentence negator fools legacy, caught now`, () => {
      const text = `Current state: ${term}. We no longer use netlify.`;
      expect(legacyForbiddenAsClaim(text, term)).toBe(false);
      expect(forbiddenAsClaim(text, term)).toBe(true);
    });

    it(`"${term}": negated in its own sentence still passes`, () => {
      expect(forbiddenAsClaim(`We no longer use ${term}.`, term)).toBe(false);
      expect(forbiddenAsClaim(`${term} is retired.`, term)).toBe(false);
    });
  }

  const deploy = MEMORY_EVALS.find((e) => e.id === "deploy-prod-source") as MemoryEval;

  it("deploy-prod-source: a real negated mention of the forbidden phrase passes", () => {
    // Unlike the older test, the forbidden phrase IS present, so negation is exercised.
    const r = gradeAnswer(deploy, "Production deploys from main via Railway to bdnick.info. It no longer deploys to Vercel.");
    expect(r.status).toBe("pass");
    expect(r.presentForbidden).toEqual([]);
  });

  it("deploy-prod-source: the claim plus an unrelated negator fails", () => {
    const r = gradeAnswer(
      deploy,
      "Production deploys from main via Railway to bdnick.info. It deploys to Vercel too. We no longer use Netlify.",
    );
    expect(r.status).toBe("fail");
    expect(r.presentForbidden).toEqual(["deploys to vercel"]);
  });
});

describe("truth-doc path is unchanged", () => {
  it("gradeDoc still ignores forbidden claims entirely", () => {
    const deploy = MEMORY_EVALS.find((e) => e.id === "deploy-prod-source") as MemoryEval;
    const r = gradeDoc(deploy, "main railway bdnick.info. It deploys to Vercel.");
    expect(r.status).toBe("pass");
    expect(r.presentForbidden).toEqual([]);
  });
});

describe("blank forbidden claims", () => {
  it("a blank term is never a claim (it cannot match everything)", () => {
    expect(forbiddenAsClaim("It deploys to Vercel.", "")).toBe(false);
    expect(forbiddenAsClaim("It deploys to Vercel.", "   ")).toBe(false);
  });

  it("validateDataset flags a planted blank forbiddenClaim", () => {
    const bad: MemoryEval = { ...vercelEval, id: "t-blank", forbiddenClaims: ["vercel", " "] };
    expect(validateDataset([bad])).toEqual(["t-blank: blank forbiddenClaim"]);
  });

  it("the real dataset has none", () => {
    expect(validateDataset(MEMORY_EVALS)).toEqual([]);
  });
});

describe("purity", () => {
  it("repeated calls give identical results (no shared regex state)", () => {
    const text = "Vercel is retired. Deploys run on Vercel.";
    const a = [forbiddenAsClaim(text, "vercel"), forbiddenAsClaim(text, "vercel")];
    expect(a).toEqual([true, true]);
  });
});

// -- Review round 2 (2026-10-09) ------------------------------------------------
// Each table is one finding. Every sentence ASSERTS the term as current and was
// masked (false) by the round-1 rule. [text, term].
const roundTwoClaims: Record<string, Array<[string, string]>> = {
  "a negation after the term must be followed by a usage word": [
    ["Vercel does not charge us for builds.", "vercel"],
    ["Vercel never goes down.", "vercel"],
    ["Vercel doesn't need a config file.", "vercel"],
    ["Deploys to Vercel don't need manual approval.", "deploys to vercel"],
    ["Vercel isn't going anywhere.", "vercel"],
    ["Hosting is on Vercel (not Netlify).", "vercel"],
    ["Prod runs on Vercel \u2014 not Netlify.", "vercel"],
    ["Prod runs on Vercel not Netlify.", "vercel"],
    ["Vercel never went away.", "vercel"],
  ],
  "a subject list needs the term to open its clause and a plural verb": [
    ["Prod runs on Vercel and Heroku is retired.", "vercel"],
    ["It deploys to Vercel and Netlify is deprecated.", "deploys to vercel"],
    ["Production is on Vercel, and Heroku was shut down.", "vercel"],
    ["Vercel and Heroku is retired.", "vercel"],
  ],
  "a post-window double negation is a claim, whatever sits between": [
    ["Vercel is not yet retired.", "vercel"],
    ["Vercel has not yet been decommissioned.", "vercel"],
    ["Vercel is not going to be retired.", "vercel"],
    ["Vercel has not been shut down.", "vercel"],
    ["Vercel wasn't turned off.", "vercel"],
    ["Vercel has not been phased out.", "vercel"],
  ],
  "a dash, colon or comma ends the clause (interjections, comma splices)": [
    ["No \u2014 it deploys to Vercel.", "vercel"],
    ["No - Vercel is the host.", "vercel"],
    ["No problem - it deploys to Vercel.", "deploys to vercel"],
    ["Not Netlify: it deploys to Vercel.", "deploys to vercel"],
    ["Netlify is not used, it deploys to Vercel.", "deploys to vercel"],
    ["It's not on Netlify, it deploys to Vercel.", "deploys to vercel"],
    ["It's not Netlify, it's Vercel.", "vercel"],
    ["We don't use Netlify, Vercel hosts prod.", "vercel"],
    ["It doesn't matter, it deploys to Vercel.", "deploys to vercel"],
    ["No worries, it deploys to Vercel.", "deploys to vercel"],
    ["Don't worry, it deploys to Vercel automatically.", "deploys to vercel"],
    ["Not sure, it deploys to Vercel.", "deploys to vercel"],
    ["Without a doubt, Vercel hosts prod.", "vercel"],
    ["No matter what, Vercel hosts prod.", "vercel"],
    ["Previously Netlify, now Vercel.", "vercel"],
    ["Formerly Heroku, now Vercel.", "vercel"],
    ["Rather than Netlify, Vercel hosts prod.", "vercel"],
    ["Dropped Heroku, now on Vercel.", "vercel"],
    ["Previously slow, it now deploys to Vercel.", "deploys to vercel"],
  ],
  "a pseudo-negation without a comma is not a negator": [
    ["No worries it deploys to Vercel.", "deploys to vercel"],
    ["Without a doubt Vercel hosts prod.", "vercel"],
    ["No it deploys to Vercel.", "vercel"],
    ["There is no issue with Vercel.", "vercel"],
  ],
  "a retirement cue counts only when the term is its direct object": [
    ["We migrated off Heroku to Vercel.", "vercel"],
    ["We moved off Netlify onto Vercel.", "vercel"],
    ["Builds stopped failing on Vercel.", "vercel"],
    ["Costs dropped on Vercel.", "vercel"],
    ["We removed the cache on Vercel.", "vercel"],
    ["We've gone all-in on Vercel.", "vercel"],
    ["Legacy apps run on Vercel.", "vercel"],
    ["Legacy routes run on Vercel.", "vercel"],
    ["The legacy app deploys to Vercel.", "deploys to vercel"],
  ],
  "a sentence that ends in a quote, bracket or markdown emphasis still ends": [
    ["(We do not use Netlify.) Vercel hosts prod.", "vercel"],
    ["**We do not use Netlify.** Vercel hosts prod.", "vercel"],
    ['He said "Netlify is not used." Vercel hosts prod.', "vercel"],
  ],
  "a later 'still' about the same subject undoes a negation": [
    ["Vercel is deprecated but still serves the marketing site.", "vercel"],
    ["Vercel is retired, but it still hosts previews.", "vercel"],
    ["We dropped Vercel but still pay for it.", "vercel"],
    ["Although Vercel is retired, it still hosts previews.", "vercel"],
  ],
  "an active phrasal verb with an object is a claim": [["Vercel shut down our old API.", "vercel"]],
};

describe("review round 2 - shapes that masked a claim are caught", () => {
  for (const [finding, rows] of Object.entries(roundTwoClaims)) {
    describe(finding, () => {
      for (const [text, term] of rows) {
        it(`"${text}" [${term}]`, () => {
          expect(forbiddenAsClaim(text, term)).toBe(true);
        });
      }
    });
  }
});

describe("review round 2 - true negations the tightened rule still clears", () => {
  const negated: Array<[string, string]> = [
    ["Vercel? No longer used.", "label after a question mark"],
    ["Vercel? Retired.", "label after a question mark"],
    ["Vercel: retired.", "label after a colon"],
    ["Vercel - retired.", "label after a spaced hyphen"],
    ["Vercel (retired 2025) is gone.", "label in brackets, retirement year"],
    ["Does it deploy to Vercel? No, it deploys via Railway.", "question answered no"],
    ["Is it on Vercel? Not anymore.", "question answered not anymore"],
    ["Vercel is history.", "post: is history"],
    ["Vercel is no more.", "post: is no more"],
    ["Vercel isn't in use anymore.", "post: negation + in use"],
    ["Vercel is no longer part of the stack.", "post: negation + part"],
    ["Vercel was shut down in 2025.", "post: phrasal, passive"],
    ["Vercel shut down in 2025.", "post: phrasal, intransitive"],
    ["We migrated off Vercel.", "pre: migrated off, direct object"],
    ["We moved away from Vercel.", "pre: moved away from"],
    ["We got rid of the old Vercel deploy.", "pre: got rid of + determiners"],
    ["We retired the legacy Vercel project.", "pre: retired + modifiers"],
    ["We stopped deploying to Vercel.", "pre: stopped + gerund + preposition"],
    ["Rather than deploying to Vercel, we use Railway.", "pre: rather than + gerund"],
    ["We switched from Vercel to Railway.", "pre: switched from"],
    ["It previously deployed to Vercel.", "pre: historical adverb"],
    ["Railway (not Vercel) hosts prod.", "pre: negator inside brackets"],
    ["Neither Netlify nor Vercel is used.", "pre: nor"],
    ["Vercel is retired, but Railway still hosts prod.", "'still' about a different subject"],
    ["Although it still bills us, Vercel is retired.", "'still' before the term"],
  ];
  for (const [text, why] of negated) {
    it(`${why}: "${text}"`, () => {
      expect(forbiddenAsClaim(text, "vercel")).toBe(false);
    });
  }
});

describe("review round 2 - end to end on the real deploy-prod-source eval", () => {
  const deploy = MEMORY_EVALS.find((e) => e.id === "deploy-prod-source") as MemoryEval;
  const lead = "Production deploys from main via Railway to bdnick.info.";
  const answers: Array<[string, string]> = [
    [`${lead} Netlify is not used, it deploys to Vercel.`, "deploys to vercel"],
    [`${lead} No worries, it deploys to Vercel too.`, "deploys to vercel"],
    [`${lead} The legacy app deploys to Vercel.`, "deploys to vercel"],
    [`${lead} Staging deploys to Vercel and Heroku is retired.`, "deploys to vercel"],
    [`${lead} Deploys to Vercel don't need approval.`, "deploys to vercel"],
    [`${lead} Don't worry, it deploys to Vercel automatically.`, "deploys to vercel"],
  ];
  for (const [answer, term] of answers) {
    it(`fails and names "${term}": ${answer.slice(lead.length + 1)}`, () => {
      const r = gradeAnswer(deploy, answer);
      expect(r.status).toBe("fail");
      expect(r.presentForbidden).toEqual([term]);
    });
  }

  it("a break inside a multi-word term does not end the term's clause", () => {
    expect(forbiddenAsClaim("Vercel - prod is retired.", "vercel - prod")).toBe(false);
    expect(forbiddenAsClaim("Vercel - prod hosts everything.", "vercel - prod")).toBe(true);
  });

  it("a CLI flag's '--' does not split the clause (accept-data-loss stays negatable)", () => {
    expect(forbiddenAsClaim("Never pass --accept-data-loss.", "accept-data-loss")).toBe(false);
    expect(forbiddenAsClaim("Run prisma db push --accept-data-loss.", "accept-data-loss")).toBe(true);
  });
});

// -- Review round 3 (2026-10-09) ------------------------------------------------
// Each table is one finding. Every sentence ASSERTS the term as current and was
// masked (false) by the round-2 rule. [text, term].
const roundThreeClaims: Record<string, Array<[string, string]>> = {
  "a modal or progressive before a retirement predicate: the term is still current": [
    ["Vercel will be retired next month.", "vercel"],
    ["Vercel will be deprecated in Q4.", "vercel"],
    ["Vercel should be removed.", "vercel"],
    ["Vercel may be replaced by Railway.", "vercel"],
    ["Vercel is being retired.", "vercel"],
    ["Vercel can be shut down once DNS moves.", "vercel"],
    ["statenour-master will be retired next week.", "statenour-master"],
    ["glm-4.7 will be replaced by a newer model.", "glm-4.7"],
    ["codex/ollama-local is being retired.", "codex/ollama-local"],
    ["The dania neglect nudge should be removed eventually.", "dania neglect nudge"],
  ],
  "and / yet / a comma, or a label, then 'still' reasserts the term": [
    ["Vercel is deprecated and still serves the marketing site.", "vercel"],
    ["Vercel was retired, yet it still serves previews.", "vercel"],
    ["Vercel is retired and still hosts previews.", "vercel"],
    ["We dropped Vercel and still pay for it.", "vercel"],
    ["Venice primary was deprecated and still serves fallback.", "venice primary"],
    ["Vercel: retired, but it still hosts previews.", "vercel"],
    ["Vercel - deprecated, but it still hosts prod.", "vercel"],
    ["Vercel? Not used for prod, but it still hosts previews.", "vercel"],
  ],
  "a historical adverb before a move verb names the NEW host; 'got used to' is not past use": [
    ["We previously migrated to Vercel.", "vercel"],
    ["We previously moved everything onto Vercel.", "vercel"],
    ["We originally chose Vercel and still use it.", "vercel"],
    ["We got used to deploying on Vercel.", "vercel"],
    ["We previously moved to glm-4.7.", "glm-4.7"],
  ],
  "a question or a hedge does not retire the term": [
    ["Is Vercel retired? No.", "vercel"],
    ["Was Vercel replaced? No, it still hosts prod.", "vercel"],
    ["Have we retired Vercel?", "vercel"],
    ["We should have retired Vercel by now.", "vercel"],
    ["We almost dropped Vercel.", "vercel"],
    ["We nearly replaced Vercel last year.", "vercel"],
    ["If we replaced Vercel, costs would drop.", "vercel"],
  ],
};

describe("review round 3 - shapes that masked a claim are caught", () => {
  for (const [finding, rows] of Object.entries(roundThreeClaims)) {
    describe(finding, () => {
      for (const [text, term] of rows) {
        it(`"${text}" [${term}]`, () => {
          expect(forbiddenAsClaim(text, term)).toBe(true);
        });
      }
    });
  }
});

// The other direction: plain CORRECT answers on the dataset's own terms that the
// round-2 rule failed (true). The term modifies a head noun ("the X branch").
const roundThreeNegations: Array<[string, string]> = [
  ["The statenour-master branch is retired.", "statenour-master"],
  ["The codex/ollama-local branch was retired.", "codex/ollama-local"],
  ["The statenour-master and codex/ollama-local branches are retired.", "codex/ollama-local"],
  ["The marriage health score was removed.", "marriage health"],
  ["The marriage health nag was scrubbed.", "marriage health"],
  ["Venice primary routing was retired.", "venice primary"],
  ["The glm-4.7 default was dropped.", "glm-4.7"],
  ["The dania neglect nudge no longer exists.", "dania neglect nudge"],
  ["The Vercel deploy is retired.", "vercel"],
  ["Vercel deploys are retired.", "vercel"],
];

describe("review round 3 - correct answers on real terms are no longer failed", () => {
  for (const [text, term] of roundThreeNegations) {
    it(`"${text}" [${term}]`, () => {
      expect(forbiddenAsClaim(text, term)).toBe(false);
    });
  }
});

describe("review round 3 guards - both directions", () => {
  const claims: Array<[string, string, string]> = [
    ["Vercel will have been retired by then.", "vercel", "a future perfect is still future"],
    ["Netlify and Vercel will be retired.", "vercel", "a modal after a subject list"],
    ["We should've retired Vercel.", "vercel", "a contracted modal perfect is a hedge"],
    ["It's used to deploy to Vercel.", "vercel", "be + used to = purpose"],
    ["We're used to deploying on Vercel.", "vercel", "be + used to = accustomed"],
    ["Is Vercel retired?", "vercel", "an unanswered question"],
    ["Vercel hosts retired apps.", "vercel", "no auxiliary after the would-be head noun"],
    ["The Vercel project hosts retired apps.", "vercel", "two nouns, still no auxiliary"],
    ["Vercel says Heroku is retired.", "vercel", "two skipped words need a determiner first"],
    ["Vercel because Heroku was retired.", "vercel", "two skipped words need a determiner first"],
    ["The statenour-master branch deploys prod.", "statenour-master", "a head noun with an active verb"],
    ["Vercel builds replaced Railway.", "vercel", "a retirement verb right after a noun is active"],
    ["Vercel is no more expensive than Railway.", "vercel", "'no more' + comparative is not 'is no more'"],
    ["We did not ban --accept-data-loss.", "accept-data-loss", "a negated ban is a double negation"],
    ["Teams used to Vercel find Railway slow.", "vercel", "'used to' + the term is accustomed, not past use"],
  ];
  for (const [text, term, why] of claims) {
    it(`claim - ${why}: "${text}"`, () => {
      expect(forbiddenAsClaim(text, term)).toBe(true);
    });
  }

  const negated: Array<[string, string, string]> = [
    ["Vercel has been retired.", "vercel", "a perfect aux chain is done"],
    ["Vercel must have been retired.", "vercel", "'must have' is epistemic past, not a hedge"],
    ["We must have retired Vercel.", "vercel", "'must have' before a retirement verb"],
    ["Vercel can no longer be used.", "vercel", "a modal before a usage negation stays negated"],
    ["Vercel must not be used.", "vercel", "a prescriptive usage negation"],
    ["Vercel is retired and Railway still hosts prod.", "vercel", "'still' about a different subject after 'and'"],
    ["Vercel is retired, Railway still hosts prod.", "vercel", "'still' about a different subject after a comma"],
    ["Vercel is deprecated and still unused.", "vercel", "'still' + a retirement word"],
    ["We did not previously migrate to Vercel.", "vercel", "a negator before the adverb still negates"],
    ["We do not deploy bdnick.info to Vercel.", "vercel", "a dot inside a token does not split the clause"],
    ["We do not use https://vercel.app anymore.", "vercel", "a colon inside a URL does not split the clause"],
    ["--accept-data-loss is banned.", "accept-data-loss", "banned is a retirement predicate"],
    ["We use Railway and the Vercel deploy is retired.", "vercel", "the term opens a clause after 'and'"],
    ["Netlify and Vercel are retired.", "vercel", "the last item of a subject list"],
    ["The Vercel deploy no longer exists.", "vercel", "head noun before a negation"],
  ];
  for (const [text, term, why] of negated) {
    it(`negated - ${why}: "${text}"`, () => {
      expect(forbiddenAsClaim(text, term)).toBe(false);
    });
  }
});

describe("review round 3 - natural answers on every real eval with forbidden claims", () => {
  const byId = (id: string) => MEMORY_EVALS.find((e) => e.id === id) as MemoryEval;
  const lead = "Production deploys from main via Railway to bdnick.info.";
  // [eval id, answer, presentForbidden]; [] = the answer passes.
  const rows: Array<[string, string, string[]]> = [
    ["deploy-prod-source", `${lead} The statenour-master branch is retired.`, []],
    ["deploy-prod-source", `${lead} The statenour-master and codex/ollama-local branches are retired.`, []],
    ["deploy-prod-source", `${lead} It no longer deploys to Vercel.`, []],
    ["deploy-prod-source", `${lead} The statenour-master branch will be retired next week.`, ["statenour-master"]],
    ["deploy-prod-source", `${lead} Staging deploys to Vercel.`, ["deploys to vercel"]],
    ["deploy-local-path", "Use C:\\Users\\nourd\\NOURCITY; the old C:\\Users\\nourd\\nour-os checkout is retired.", []],
    ["deploy-local-path", "Use C:\\Users\\nourd\\nour-os, the NOURCITY clone.", ["c:\\users\\nourd\\nour-os"]],
    ["mig-column-first", "Ship column-first. --accept-data-loss is banned.", []],
    ["mig-column-first", "Ship column-first and never pass --accept-data-loss.", []],
    ["mig-column-first", "Ship column-first; run prisma db push --accept-data-loss if columns drift.", ["accept-data-loss"]],
    [
      "pos-no-relationship-nag",
      "No, a guardrail forbids it: the marriage health score was removed and the dania neglect nudge no longer exists.",
      [],
    ],
    ["pos-no-relationship-nag", "The guardrail allows it; the dania neglect nudge should be removed eventually.", ["dania neglect nudge"]],
    [
      "prov-source",
      "Read lib/ai/provider.ts and the ai_provider setting. Venice primary routing was retired and the glm-4.7 default was dropped.",
      [],
    ],
    ["prov-source", "Read lib/ai/provider.ts and ai_provider. We previously moved to glm-4.7.", ["glm-4.7"]],
  ];
  for (const [id, answer, present] of rows) {
    it(`${id}: ${present.length ? "fails" : "passes"} - ${answer}`, () => {
      const r = gradeAnswer(byId(id), answer);
      expect(r.missingFacts).toEqual([]); // the answer carries every expected fact
      expect(r.presentForbidden).toEqual(present);
      expect(r.status).toBe(present.length ? "fail" : "pass");
    });
  }

  it("covers every eval that has forbidden claims", () => {
    const withClaims = MEMORY_EVALS.filter((e) => e.forbiddenClaims.length > 0).map((e) => e.id);
    expect(new Set(rows.map(([id]) => id))).toEqual(new Set(withClaims));
  });
});

describe("cost stays linear in the answer length", () => {
  // Round 1 ran a backtracking sentence regex and rescanned every boundary per
  // occurrence: 32k dots took 3.7 s and 20k occurrences 4.8 s on the dev box.
  it("a long punctuation run is cheap", () => {
    const t0 = performance.now();
    expect(forbiddenAsClaim(`Vercel ${".".repeat(64_000)}x`, "vercel")).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1_500);
  });

  it("many occurrences are cheap", () => {
    const t0 = performance.now();
    expect(forbiddenAsClaim("Vercel is retired. ".repeat(40_000), "vercel")).toBe(false);
    expect(performance.now() - t0).toBeLessThan(1_500);
  });

  it("many occurrences inside ONE clause are cheap (windows are capped)", () => {
    const t0 = performance.now();
    expect(forbiddenAsClaim("not Vercel ".repeat(40_000), "vercel")).toBe(false);
    expect(performance.now() - t0).toBeLessThan(1_500);
  });
});

describe("known trade-offs, pinned so a future fix flips them deliberately", () => {
  it("false FAIL: a question mentioning the term counts as a claim (strict)", () => {
    expect(forbiddenAsClaim("Does it deploy to Vercel?", "vercel")).toBe(true);
    // Even answered "No": the polarity of the answer depends on the question's predicate.
    expect(forbiddenAsClaim("Is Vercel still used? No.", "vercel")).toBe(true);
  });

  it("false FAIL: a list or aside after a comma loses the leading negator", () => {
    expect(forbiddenAsClaim("We do not use Netlify, Heroku, Fly or Vercel.", "vercel")).toBe(true);
    expect(forbiddenAsClaim("We no longer, as of 2025, deploy to Vercel.", "vercel")).toBe(true);
    expect(forbiddenAsClaim("Vercel, which was retired in 2025, is gone.", "vercel")).toBe(true);
  });

  it("false FAIL: 'still' after a retirement reads as a reassertion even when it is not about the term", () => {
    expect(forbiddenAsClaim("Vercel is retired and still isn't used.", "vercel")).toBe(true);
    // "we" may sit before "still" because "we dropped Vercel but we still pay for it" reasserts.
    expect(forbiddenAsClaim("Vercel was retired and we still deploy from main.", "vercel")).toBe(true);
  });

  it("false FAIL: a past passive 'was used to <verb>' reads as purpose, not past use", () => {
    expect(forbiddenAsClaim("It was used to deploy to Vercel.", "vercel")).toBe(true);
  });

  it("false FAIL: a negated role that is not a usage word", () => {
    expect(forbiddenAsClaim("GLM-4.7 is no longer the default.", "glm-4.7")).toBe(true);
  });

  it("false PASS: a modal before a usage negation reads as prescriptive", () => {
    expect(forbiddenAsClaim("Vercel will no longer be used.", "vercel")).toBe(false);
  });

  it("false PASS: a compound noun whose head is not the term's referent", () => {
    expect(forbiddenAsClaim("The Vercel free tier was removed.", "vercel")).toBe(false);
  });

  it("false PASS: a usage negation with a scope", () => {
    expect(forbiddenAsClaim("Vercel is not used by staging, only by prod.", "vercel")).toBe(false);
  });

  it("false FAIL: a negator further than K tokens away in the same clause", () => {
    expect(forbiddenAsClaim("It no longer has anything to do with Vercel.", "vercel")).toBe(true);
    // The real mig-column-first term: a long command between the verb and the flag.
    expect(forbiddenAsClaim("Do not run prisma db push --accept-data-loss.", "accept-data-loss")).toBe(true);
  });

  it("false FAIL: a negative subject alone does not negate", () => {
    expect(forbiddenAsClaim("Nothing runs on Vercel anymore.", "vercel")).toBe(true);
  });

  it("false FAIL: a negated predicate that is not a usage word", () => {
    expect(forbiddenAsClaim("Vercel is not the production host.", "vercel")).toBe(true);
  });

  it("false PASS: a particle within K over a non-usage verb, term in a prepositional phrase", () => {
    expect(forbiddenAsClaim("Builds don't fail on Vercel.", "vercel")).toBe(false);
    expect(forbiddenAsClaim("We never had problems with Vercel.", "vercel")).toBe(false);
  });

  it("false PASS: a bracket label hides what follows the bracket", () => {
    expect(forbiddenAsClaim("Vercel (deprecated) still hosts prod.", "vercel")).toBe(false);
    expect(forbiddenAsClaim("Vercel (no longer used for prod) hosts previews.", "vercel")).toBe(false);
  });
});
