/** One open PR as the repo's board (scripts/agent-os/board.mjs) records it. */
export type Pr = { number: number; title: string; checks: string | null }

/**
 * One read of the machine and the board. A part that failed to read is null with its reason in `errors`,
 * never a zero: "0 open PRs" and "couldn't read the PRs" must not look alike.
 */
export type Snapshot = {
  at: number
  ramMb: number | null
  heavy: string | null
  chrome: string | null
  prs: Pr[] | null
  boardAgeMin: number | null
  main: string | null
  errors: string[]
}

/** The last `repo-status.mjs --sweep` preview (read-only): its class counts, or why it failed. */
export type Trees = { at: number; counts: Record<string, number> | null; error: string | null }

declare module 'claude-code' {
  interface PluginState {
    'nourcity-harness': {
      snap: Shaped<Snapshot | null>
      trees: Shaped<Trees | null>
      busy: boolean
    }
  }
}
