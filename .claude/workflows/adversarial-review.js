export const meta = {
  name: 'adversarial-review',
  description: 'Lens reviewers find defects in a diff, then skeptics try to refute each finding before it is reported',
  whenToUse: 'monorepo-manager step 10: review the integration branch before the PR opens. Needs the operator workflow opt-in.',
  phases: [
    { title: 'Find', detail: 'one read-only reviewer per lens over the diff' },
    { title: 'Refute', detail: 'skeptics try to refute each finding against the real files' },
  ],
}

// args: { base?: 'origin/main', head?: 'HEAD', note?: 'what the change claims', skeptics?: 3, lenses?: [{ key, prompt }] }
const A = args ?? {}
const BASE = A.base ?? 'origin/main'
const HEAD = A.head ?? 'HEAD'
const NOTE = A.note ?? '(no claim given: read the commit messages)'
const SKEPTICS = A.skeptics ?? 3

const DEFAULT_LENSES = [
  { key: 'bypass', prompt: 'Find inputs the real binary or process accepts that the change says it refuses: boundaries at cap-1, cap, cap+1 and the bad item last, ordering, encodings, flag and quoting variants. Run the real entry point, not the function.' },
  { key: 'silent-instrument', prompt: 'Find tests, canaries and checks that cannot fail: they assert presence instead of behavior, share a code path with what they test, assert a value a comment also contains, or were never run against the unfixed code.' },
  { key: 'consumer', prompt: 'Find writers nothing reads: a registration with no reachable caller, a rule id no output prints, a config key no process loads, a skill or file named only in prose. Trace from the entry point the consumer really uses.' },
  { key: 'scope', prompt: 'Find files outside the lane owned paths, unrelated edits, generated files, and path exceptions nobody authorized. Compare the diff to the brief.' },
  { key: 'docs-vs-code', prompt: 'Find every count, number, path, command, status and sentence in docs, comments and the PR body that the code or the repo contradicts. Recompute each number.' },
  { key: 'names-and-facts', prompt: 'Find identifiers, tool names, flags, rule ids, URLs and external claims that do not resolve or have no quote behind them. Resolve each against the live source; label what you could not check.' },
]
const LENSES = A.lenses ?? DEFAULT_LENSES

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          claim: { type: 'string' },
          evidence: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
        },
        required: ['title', 'file', 'claim', 'evidence', 'severity'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

const finderPrompt = (lens) =>
  `You are a hostile reviewer with ONE lens: ${lens.key}. Read-only: do not edit, commit, push or call any tool that writes.\n` +
  `The change under review is \`git diff ${BASE}...${HEAD}\`. What it claims: ${NOTE}\n` +
  `Lens: ${lens.prompt}\n` +
  `Open the real files; do not review from the diff text alone. Report only defects you can point to with a file, a line and evidence ` +
  `(a command and its output, or the exact text). A hunch is not a finding. Return an empty list if there are none.`

const skepticPrompt = (f, lens, i) =>
  `Skeptic ${i + 1}. A reviewer (lens: ${lens.key}) reports this against \`git diff ${BASE}...${HEAD}\`:\n` +
  `${f.title} [${f.severity}] at ${f.file}${f.line ? ':' + f.line : ''}\nClaim: ${f.claim}\nEvidence: ${f.evidence}\n\n` +
  `Try to REFUTE it. Open the file and re-run the evidence yourself. Read-only. refuted=true if the evidence does not reproduce, the code ` +
  `already handles it, or you cannot confirm it from the real files. refuted=false only if you reproduced the defect. Give the reason in one sentence.`

phase('Find')
const perLens = await pipeline(
  LENSES,
  (lens) => agent(finderPrompt(lens), { label: `find:${lens.key}`, phase: 'Find', schema: FINDINGS }),
  async (found, lens) => {
    if (!found) return null
    const judged = await parallel(
      (found.findings ?? []).map((f) => async () => {
        const votes = (
          await parallel(
            Array.from({ length: SKEPTICS }, (_, i) => () =>
              agent(skepticPrompt(f, lens, i), { label: `refute:${lens.key}:${f.title.slice(0, 24)}#${i + 1}`, phase: 'Refute', schema: VERDICT }),
            ),
          )
        ).filter(Boolean)
        const refuted = votes.filter((v) => v.refuted).length
        return { ...f, lens: lens.key, votes: votes.length, refuted, reasons: votes.map((v) => v.refuted + ': ' + v.reason) }
      }),
    )
    return judged.filter(Boolean)
  },
)

const all = perLens.filter(Boolean).flat()
// A finding survives unless a majority of the skeptics that answered refuted it. With no answers at all (votes 0) it is kept.
const confirmed = all.filter((f) => f.refuted * 2 <= f.votes)
const dropped = all.filter((f) => !confirmed.includes(f))
const failedLenses = LENSES.filter((_, i) => !perLens[i]).map((l) => l.key)

log(`${all.length} finding(s) from ${LENSES.length - failedLenses.length} lens(es); ${confirmed.length} survived, ${dropped.length} dropped`)
if (failedLenses.length) log(`NOT COVERED: lens(es) that returned nothing: ${failedLenses.join(', ')}`)
for (const d of dropped) log(`dropped (${d.refuted}/${d.votes} refuted): [${d.lens}] ${d.title} at ${d.file}`)

return { base: BASE, head: HEAD, confirmed, dropped, failedLenses, lensesRun: LENSES.map((l) => l.key) }
