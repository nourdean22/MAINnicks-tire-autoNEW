export const meta = {
  name: 'adversarial-review',
  description: 'Read-only lens reviewers find defects in a branch, then skeptics try to refute each finding with a reproduction',
  whenToUse: 'monorepo-manager step 10: review the integration branch before the PR opens. Needs the operator workflow opt-in.',
  phases: [
    { title: 'Review', detail: 'one read-only reviewer per lens over the diff' },
    { title: 'Verify', detail: 'skeptics in different roles try to refute each finding' },
  ],
}

// args: { worktree?, base?: 'origin/main', head?: 'HEAD', change?: 'what the branch does and why', accepted?: ['documented limits that are not findings'],
//         skeptics?: 2, lenses?: [{ key, task }] }
// Shape taken from a working five-lens review of the guard PRs (2026-10-15): the context names the worktree, the base and the accepted limits,
// a finding must carry a repro, each lens reports what it checked (so an empty list is not mistaken for a lens that never ran), and the
// skeptics play different roles instead of N copies of one.
const A = args ?? {}
const WORKTREE = A.worktree ?? '(the current working directory)'
const BASE = A.base ?? 'origin/main'
const HEAD = A.head ?? 'HEAD'
const CHANGE = A.change ?? '(not given: read the commit messages with git log)'
const ACCEPTED = A.accepted ?? []
const SKEPTICS = A.skeptics ?? 2

const DEFAULT_LENSES = [
  { key: 'bypass', task: 'Lens: BYPASS. Find inputs the real binary or process accepts that the change says it refuses: boundaries at cap-1, cap, cap+1 and the bad item last, ordering, encodings, flag and quoting variants, and realistic input it wrongly refuses. Run the real entry point, not the function.' },
  { key: 'silent-instrument', task: 'Lens: SILENT INSTRUMENTS. Read the new and changed tests and checks. For each ask: could it pass while the thing it guards is broken? Hunt assertions satisfied by a comment or a doc mention, mutations that are no-ops, fixtures that quote the code under test, counts that make routine edits fail, tests that depend on the machine (paths, env, CRLF, timing), silent skips. Run the tests and mutate copies in the temp dir to prove at least three can fail.' },
  { key: 'consumer', task: 'Lens: CONSUMER. Find writers nothing reads: a registration with no reachable caller, a rule id no output prints, a config key no process loads, a file named only in prose. Trace from the entry point the consumer really uses, and say which settings or files that consumer really loads.' },
  { key: 'scope', task: 'Lens: SCOPE. Find files outside the lane owned paths, unrelated edits, generated files, and path exceptions nobody authorized. Compare the diff to the brief.' },
  { key: 'docs-vs-code', task: 'Lens: DOCS AND CLAIMS. Verify every checkable claim in docs, comments, ledger rows and the PR body against the code: counts, numbers, paths, commands, test names, statuses, "proven" versus "tested". Recompute each number. Look for stale sentences in sections the diff did not touch.' },
  { key: 'names-and-facts', task: 'Lens: NAMES AND FACTS. Find identifiers, tool names, flags, rule ids, URLs and external claims that do not resolve or have no quote behind them. Resolve each against the live source and label what you could not check.' },
]
const LENSES = A.lenses ?? DEFAULT_LENSES

const CTX =
  'You are reviewing a branch in the NOURCITY monorepo as a HOSTILE reviewer. A bot reviewer will also read it.\n' +
  'READ-ONLY JOB. Do not edit, create or delete any file inside the repo or the worktree. Write scratch scripts to the OS temp dir, never into the repo. No network calls. ' +
  'Do not call any tool that changes a remote system (Railway, Neon, Vercel, Prisma, GitHub writes); looking up tool names is fine.\n' +
  `Worktree holding the branch: ${WORKTREE}\nDiff: git diff ${BASE}...${HEAD} (and git log ${BASE}..${HEAD}).\nWhat the change does: ${CHANGE}\n` +
  (ACCEPTED.length ? `Documented, ACCEPTED limits (not findings unless the docs misdescribe them):\n${ACCEPTED.map((a) => ' - ' + a).join('\n')}\n` : '') +
  'A finding must be REAL and DEMONSTRABLE: file and line, the claim, the evidence, and a repro (a command or payload that shows it). ' +
  'Severity: P0 = ships a wrong result or silently disables a protection; P1 = a bypass or a false positive on realistic input, or a test that cannot fail; P2 = a misleading claim, weak test or maintenance trap; P3 = a nit. ' +
  'Return an EMPTY findings list for a lens that finds nothing real, and say in `checked` exactly what you looked at: do not pad.'

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          claim: { type: 'string' },
          evidence: { type: 'string' },
          repro: { type: 'string' },
        },
        required: ['severity', 'title', 'file', 'claim', 'evidence', 'repro'],
      },
    },
    checked: { type: 'string' },
  },
  required: ['findings', 'checked'],
}
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' }, evidence: { type: 'string' }, severity_if_real: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3', 'none'] } },
  required: ['refuted', 'reason', 'evidence', 'severity_if_real'],
}

const ROLES = [
  'Reproduce it yourself exactly as the repro says (run the command or payload). If it does not reproduce, it is refuted.',
  'Argue it is NOT a real defect: a documented accepted limit, out of scope for this change, harmless in practice, or a severity that is inflated. Check the accepted limits. If you cannot honestly argue that, it is not refuted.',
  'Read the code and docs the finding cites. If what they say contradicts the claim, it is refuted.',
]

const skepticPrompt = (f, lens, i) =>
  `${CTX}\n\nYou are SKEPTIC ${i + 1} of ${SKEPTICS}. A reviewer (lens: ${lens.key}) reports this finding:\n${JSON.stringify(f, null, 1)}\n\n` +
  `Try to REFUTE it. Your role: ${ROLES[i % ROLES.length]}\nDefault to refuted=true if you cannot confirm it with evidence you produced yourself. Report severity_if_real honestly.`

phase('Review')
const perLens = await pipeline(
  LENSES,
  (lens) => agent(`${CTX}\n\n${lens.task}`, { label: `find:${lens.key}`, phase: 'Review', schema: FINDINGS }),
  async (found, lens) => {
    if (!found) return null
    log(`${lens.key}: ${(found.findings ?? []).length} candidate(s). Checked: ${String(found.checked).slice(0, 160)}`)
    const judged = await parallel(
      (found.findings ?? []).map((f) => async () => {
        const votes = (
          await parallel(
            Array.from({ length: SKEPTICS }, (_, i) => () =>
              agent(skepticPrompt(f, lens, i), { label: `refute:${lens.key}:${f.title.slice(0, 24)}#${i + 1}`, phase: 'Verify', schema: VERDICT }),
            ),
          )
        ).filter(Boolean)
        const refuted = votes.filter((v) => v.refuted).length
        return { ...f, lens: lens.key, votes: votes.length, refuted, skeptics: votes.map((v) => ({ refuted: v.refuted, severity_if_real: v.severity_if_real, reason: String(v.reason).slice(0, 300) })) }
      }),
    )
    return { lens: lens.key, checked: found.checked, findings: judged.filter(Boolean) }
  },
)

const lensRuns = perLens.filter(Boolean)
const all = lensRuns.flatMap((r) => r.findings)
// A finding survives unless a majority of the skeptics that answered refuted it. With no answers at all (votes 0) it is kept.
const confirmed = all.filter((f) => f.refuted * 2 <= f.votes)
const dropped = all.filter((f) => !confirmed.includes(f))
const failedLenses = LENSES.filter((_, i) => !perLens[i]).map((l) => l.key)

log(`${all.length} finding(s) from ${lensRuns.length} lens(es); ${confirmed.length} survived, ${dropped.length} dropped`)
if (failedLenses.length) log(`NOT COVERED: lens(es) that returned nothing: ${failedLenses.join(', ')}`)
for (const d of dropped) log(`dropped (${d.refuted}/${d.votes} refuted): [${d.lens}] ${d.title} at ${d.file}`)

return { worktree: WORKTREE, base: BASE, head: HEAD, confirmed, dropped, failedLenses, lensesRun: LENSES.map((l) => l.key), checked: lensRuns.map((r) => ({ lens: r.lens, checked: r.checked })) }
