# Wisdom Packs · Naval + Munger + Bezos · v10.0.524

Three new wisdom intelligence packs added to the brain corpus on
2026-05-12, expanding the curated-wisdom layer from 241 entries
toward 354 (41 Naval + 41 Munger + 31 Bezos = 113 new). They
join the existing roster:

- Steve Jobs · 12 entries (v10.0.353)
- Satori therapeutic frameworks · 10 entries (v10.0.353)
- Buffett · 10 entries (v10.0.365)
- Bill Gates · 10 entries (v10.0.365)
- Elon Musk · 10 entries (v10.0.365)
- Robert Greene · 189 laws (v10.0.382)

## Pack files

- `data/wisdom/naval-ravikant.json` · 41 entries
- `data/wisdom/charlie-munger.json` · 41 entries
- `data/wisdom/bezos-letters.json` · 31 entries

Schema mirrors the canonical wisdom-pack shape:

```json
{
  "pack": "<slug>",
  "source_credit": "<citations>",
  "version": "v10.0.524",
  "entries": [
    {
      "text": "<wisdom · 1-3 sentences>",
      "topic": "<one of money/people/strategy/execution/ops/brand/self/body/time/power>",
      "confidence": 0.85-0.98,
      "context": "<provenance · citation · paraphrase flag>",
      "tags": ["<freeform>", "..."]
    }
  ]
}
```

Topic field uses the existing 10-domain taxonomy defined in
`lib/brain/wisdom-topic-tagger.ts`. The auto-tagger will re-derive
multi-topic assignments at ingestion time; the explicit `topic`
field is the curator's primary classification.

## Provenance discipline

Quotes are verbatim and well-attested when `confidence ≥ 0.95` —
sourced from the speaker's original venue (annual letter, named
podcast, recorded keynote, or canonical book). Anything below
0.95 is either a paraphrase of a recurring idea (labeled "paraphrased
from..." in the `context` field) or a quote where wording varies
across attributions. Nothing in these packs is fabricated.

Cited primary sources:

- **Naval:** the May 31, 2018 "How to Get Rich · without getting
  lucky" tweetstorm + the Almanack of Naval Ravikant (Eric
  Jorgenson, 2020) + Joe Rogan Experience #1309 + Tim Ferriss Show
  #97/#136/#473.
- **Munger:** Poor Charlie's Almanack (Peter Kaufman, ed.) + the
  1995 Harvard speech 'The Psychology of Human Misjudgment' + USC
  Law Commencement 2007 + Harvard School Commencement 1986 +
  Berkshire Hathaway and Daily Journal annual meetings.
- **Bezos:** Amazon shareholder letters 1997-2020 (the 1997 letter
  is canonical and re-attached to every subsequent letter) + Invent
  and Wander (Walter Isaacson, ed.) + The Everything Store (Brad
  Stone) + Lex Fridman Podcast #405.

## When Nick should surface each pack

Recall is automatic via the brain pipeline (semantic + tag +
topic-boost) — Nick will pull the most relevant wisdom regardless
of pack source. The intent below tells the operator which pack to
expect dominant on a given question type:

| Question intent                                | Dominant pack | Why                                                                  |
|------------------------------------------------|---------------|----------------------------------------------------------------------|
| Wealth / leverage / specific-knowledge / scale | Naval         | Four-leverage taxonomy + accountability + brand-as-product           |
| Decisions / cognitive bias / clarity / inversion | Munger      | Mental-models latticework + 25 biases + lollapalooza framework       |
| Decision velocity / customer focus / invention | Bezos         | Type 1 vs Type 2 doors + regret minimization + Day 1 mindset         |
| Long-term thinking / patience / compounding    | Naval + Munger + Bezos | All three converge on long-horizon · use the one closest to context |

## Manual surfacing via Nick

The operator can also call a specific pack explicitly in a chat
prompt:

- "What would Naval say about pricing this?"
- "Run a Munger inversion on this hire decision."
- "How would Bezos frame this Type 2 / Type 1 split?"

Tag matching (`leverage`, `inversion`, `day-1`, `regret-
minimization`, etc.) will bias recall toward the named-pack
entries. Confidence scores ≥ 0.95 will rank higher in the wisdom
slot (per `contextual-recall.ts` source-trust 1.5× and CoALA
procedural-kind boost at v10.0.367).

## Operator action items

1. Run the ingest script to load these JSON packs into BrainMemory:
   ```
   pnpm tsx scripts/ingest-wisdom-pack.ts
   ```
   (or the equivalent loader that consumes `data/wisdom/*.json`)
2. Verify counts at `/brain/wisdom` — Naval should show 41 entries,
   Munger 41, Bezos 31.
3. Update the curated-wisdom total in the brain readme: 241 → 354.
4. Spot-check 3-5 entries per pack in the dashboard to confirm
   topic assignment matches intent.

## Pack stats

- Total new curated entries: **113**
- Topic distribution (primary topic):
  - self: 29
  - strategy: 23
  - money: 16
  - people: 11
  - execution: 9
  - ops: 9
  - power: 7
  - brand: 5
  - time: 4
  - body: 0 (none of these three thinkers center body)
- Average confidence: **0.939**
- Verbatim quotes (confidence ≥ 0.95): **62**
- Paraphrased ideas (confidence < 0.95): **51**

## Future expansion candidates (not in scope here)

- Ben Franklin · 13 virtues + Poor Richard's Almanack
- Marcus Aurelius · Meditations (already partially in Satori pack)
- Peter Thiel · Zero to One + Stanford CS183 lectures
- Andy Grove · High Output Management + Only the Paranoid Survive
- Jim Collins · Good to Great + Built to Last
- Reid Hoffman · The Start-Up of You + Blitzscaling
