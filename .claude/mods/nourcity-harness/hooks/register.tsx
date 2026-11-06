import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PlaygroundHealth, Pr, ServiceState, Snapshot, Trees } from '../types'

// The harness pane reads status from the repo's own scripts and the Playground bridge. Only its
// explicit Playground buttons can launch the app; all scheduled status reads remain read-only.

const PANE = 'harness'
const TITLE = 'Harness'
// Every session runs its own tick, so keep it slow: 5 minutes, and never a second refresh while one is still running.
const TICK_MS = 300_000
const SWEEP_TIMEOUT_MS = 300_000
const PLAYGROUND_CLI = 'tools/sovereign-dev/ai-playground.mjs'
const AI_STATES = ['OK', 'OFF', 'UNAVAILABLE', 'UNKNOWN'] as const
// Change a tag when that value's fields change: it declines what an earlier version stored.
const snap = atom({ plugin: 'nourcity-harness', key: 'snap' } as const, null, { shape: 'snap-1' })
const playgroundState = atom({ plugin: 'nourcity-harness', key: 'playground' } as const, null, { shape: 'playground-1' })
const trees = atom({ plugin: 'nourcity-harness', key: 'trees' } as const, null, { shape: 'trees-1' })
const busy = atom({ plugin: 'nourcity-harness', key: 'busy' } as const, false)

// Prints board.json (the cache board.mjs keeps outside the repo) or exits non-zero.
const READ_BOARD =
  "const p=require('path'),f=require('fs');" +
  "const d=process.env.BOARD_DIR||p.join(process.env.LOCALAPPDATA||p.join(require('os').homedir(),'.local','state'),'nourcity','board');" +
  "process.stdout.write(f.readFileSync(p.join(d,'board.json'),'utf8'))"

/** The checkout that owns `cwd`: a `.claude/worktrees/<name>` path resolves to its primary. */
export function repoRootOf(cwd: string): string {
  const path = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const at = path.indexOf('/.claude/worktrees/')

  return at >= 0 ? path.slice(0, at) : path
}

/** The NOURCITY checkout holding `cwd`: the nearest ancestor (worktree paths first resolved to their primary) with scripts/agent-os/board.mjs, or null. */
async function findRoot($: EngineInterface, cwd: string): Promise<string | null> {
  let dir = repoRootOf(cwd)
  for (;;) {
    try {
      await $.fs.stat(`${dir}/scripts/agent-os/board.mjs`)

      return dir
    } catch {
      const parent = dir.replace(/\/[^/]*$/, '')
      if (parent === dir || parent === '') return null
      dir = parent
    }
  }
}

export function parseHeavy(stdout: string): { ramMb: number | null; heavy: string | null; chrome: string | null } {
  const ram = /free RAM:\s*(\d+)\s*MB/.exec(stdout)

  return {
    ramMb: ram ? Number(ram[1]) : null,
    heavy: /^heavy:\s*(.+)$/m.exec(stdout)?.[1]?.trim() ?? null,
    chrome: /^chrome:\s*(.+)$/m.exec(stdout)?.[1]?.trim() ?? null,
  }
}

/** The sweep's summary line (`LANDED 13 · OPEN_PR 0 · ... · removed 0`) as counts; null when the line is absent. */
export function parseSweep(stdout: string): Record<string, number> | null {
  const line = /^LANDED \d+ · .*$/m.exec(stdout)?.[0]
  if (!line) return null
  const counts: Record<string, number> = {}
  for (const part of line.split(' · ')) {
    const [, name, n] = /^(\S+) (\d+)$/.exec(part.trim()) ?? []
    if (name && n) counts[name] = Number(n)
  }

  return counts
}

export function checkWord(checks: string | null): string {
  if (checks === 'SUCCESS') return 'green'
  if (checks === 'FAILURE' || checks === 'ERROR') return 'red'
  if (checks === 'PENDING' || checks === 'EXPECTED') return 'running'

  return checks ? checks.toLowerCase() : 'no checks'
}

export function statusLine(s: Snapshot): string {
  const ram = s.ramMb === null ? 'RAM ?' : `RAM ${(s.ramMb / 1024).toFixed(1)} GB`
  const heavy = s.heavy === null ? 'heavy ?' : s.heavy === 'free' ? 'heavy free' : 'heavy busy'
  const red = s.prs?.filter(pr => checkWord(pr.checks) === 'red').length ?? 0
  const prs = s.prs === null ? 'PRs ?' : `${s.prs.length} PRs${red ? `, ${red} red` : ''}`

  return `${ram} · ${heavy} · ${prs}`
}

const lastLine = (text: string) =>
  text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .pop()
    ?.slice(0, 160) ?? ''

const cut = (text: string, n: number) => (text.length > n ? `${text.slice(0, Math.max(1, n - 1))}…` : text)

// The checkout this session's harness reads; set by session.start, null outside a NOURCITY checkout.
let root: string | null = null
// True from the start of a refresh to its end; only the timer reads it (a button press is the user's call).
let refreshing = false
let refreshingWithGh = false
let activeRefresh: Promise<void> | null = null
let queuedGhResolvers: Array<() => void> = []
let playgroundActionBusy = false
let playgroundRevision = 0

/** Only copy fixed state labels and a count from the bridge receipt; never persist its model ID. */
export function parsePlayground(stdout: string): PlaygroundHealth | null {
  try {
    const data = JSON.parse(stdout) as {
      schemaVersion?: unknown
      services?: Record<string, unknown>
      mcp?: { status?: unknown; names?: unknown }
    }
    if (!data || typeof data !== 'object' || data.schemaVersion !== 1 || !data.services || typeof data.services !== 'object') return null
    const state = (value: unknown): ServiceState => AI_STATES.includes(value as ServiceState) ? value as ServiceState : 'UNKNOWN'
    const services = data.services
    const names = data.mcp?.names
    const mcpStatus = state(data.mcp?.status)
    const validNames = Array.isArray(names) && names.length > 0 && names.every(name => typeof name === 'string' && name.trim().length > 0)

    return {
      services: {
        playground: state(services.playground),
        llamaCpp: state(services.llamaCpp),
        coreServices: state(services.coreServices),
        homeAgent: state(services.homeAgent),
        comfyui: state(services.comfyui),
        openvino: state(services.openvino),
        tts: state(services.tts),
        whisper: state(services.whisper),
      },
      mcp: {
        status: mcpStatus === 'OK' && !validNames ? 'UNKNOWN' : mcpStatus,
        count: validNames ? (names as string[]).length : 0,
      },
    }
  } catch {
    return null
  }
}

async function readPlayground($: EngineInterface): Promise<PlaygroundHealth | null> {
  if (root === null) return null
  try {
    const ran = await $.process.run(['node', PLAYGROUND_CLI, 'health', '--json'], { cwd: root, timeoutMs: 15_000 })
    return ran.exitCode === 0 ? parsePlayground(ran.stdout) : null
  } catch {
    return null
  }
}

/** Start or open is reachable only from a user action; scheduled refreshes call readPlayground only. */
async function playgroundAction($: EngineInterface, action: 'start' | 'open'): Promise<void> {
  if (root === null || playgroundActionBusy) return
  playgroundActionBusy = true
  try {
    const ran = await $.process.run(['node', PLAYGROUND_CLI, action, '--json'], { cwd: root, timeoutMs: 15_000 })
    if (ran.exitCode !== 0) throw new Error('Playground action failed')
    let playground: PlaygroundHealth | null = null
    for (let attempt = 0; attempt < 4; attempt++) {
      playground = await readPlayground($)
      if (playground?.services.llamaCpp === 'OK') break
      if (attempt < 3) await $.clock.sleep(1_500)
    }
    playgroundRevision++
    await update($, playgroundState, () => playground)
    $.ui.status(playground?.services.llamaCpp === 'OK' ? 'AI Playground model ready' : 'AI Playground opened; model status is shown in /harness')
  } catch {
    playgroundRevision++
    await update($, playgroundState, () => null)
    $.ui.status('AI Playground could not be opened; check the local installation')
  } finally {
    playgroundActionBusy = false
  }
}

/** The timer's refresh: skipped while the last one is still running, so slow scripts never stack up node processes. */
async function tick($: EngineInterface): Promise<void> {
  if (refreshing) return
  await refresh($, false)
}

function refresh($: EngineInterface, withGh: boolean): Promise<void> {
  if (root === null) return Promise.resolve()
  if (refreshing) {
    if (!withGh) return Promise.resolve()
    if (refreshingWithGh) return activeRefresh ?? Promise.resolve()
    return new Promise(resolve => queuedGhResolvers.push(resolve))
  }
  refreshing = true
  refreshingWithGh = withGh
  const current = (async () => {
    try {
      await refreshOnce($, withGh)
    } finally {
      refreshing = false
      refreshingWithGh = false
      if (queuedGhResolvers.length > 0) {
        const resolveQueued = queuedGhResolvers
        queuedGhResolvers = []
        try {
          await refresh($, true)
        } finally {
          for (const resolve of resolveQueued) resolve()
        }
      }
    }
  })()
  activeRefresh = current
  return current.finally(() => {
    if (activeRefresh === current) activeRefresh = null
  })
}

async function refreshOnce($: EngineInterface, withGh: boolean): Promise<void> {
  if (root === null) return
  await update($, busy, () => true)
  const errors: string[] = []
  let heavy: ReturnType<typeof parseHeavy> = { ramMb: null, heavy: null, chrome: null }
  let prs: Pr[] | null = null
  let main: string | null = null
  let boardAgeMin: number | null = null
  const playgroundRevisionAtStart = playgroundRevision
  const playground = await readPlayground($)
  if (playgroundRevision === playgroundRevisionAtStart) await update($, playgroundState, () => playground)
  try {
    const ran = await $.process.run(['node', 'scripts/agent-os/heavy.mjs', 'status'], { cwd: root, timeoutMs: 15_000 })
    heavy = parseHeavy(ran.stdout)
    if (ran.exitCode !== 0 || heavy.ramMb === null) errors.push(`heavy status: exit ${ran.exitCode} ${lastLine(ran.stderr)}`.trim())
  } catch (err) {
    errors.push(`heavy status: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    if (withGh) {
      const fresh = await $.process.run(['node', 'scripts/agent-os/board.mjs', 'refresh'], { cwd: root, timeoutMs: 30_000 })
      if (fresh.exitCode !== 0) errors.push(`board refresh: exit ${fresh.exitCode} ${lastLine(fresh.stderr)}`.trim())
    }
    const ran = await $.process.run(['node', '-e', READ_BOARD], { cwd: root, timeoutMs: 10_000 })
    if (ran.exitCode !== 0) throw new Error(`exit ${ran.exitCode} ${lastLine(ran.stderr)}`.trim())
    const board = JSON.parse(ran.stdout) as {
      updatedMs?: number
      prs?: Array<{ number: number; title: string; checks?: string | null }>
      prsError?: string | null
      main?: Array<{ subject?: string }>
    }
    // board.mjs keeps the last good list (or []) when the GitHub read fails; that list is not a reading, so the PRs stay unknown.
    if (board.prsError) errors.push(`board PRs: ${board.prsError}`)
    else if (Array.isArray(board.prs)) {
      prs = board.prs.map(pr => ({ number: pr.number, title: pr.title, checks: pr.checks ?? null }))
    }
    main = board.main?.[0]?.subject ?? null
    if (typeof board.updatedMs === 'number') boardAgeMin = Math.round(((await $.clock.now()) - board.updatedMs) / 60_000)
  } catch (err) {
    errors.push(`board: ${err instanceof Error ? err.message : String(err)}`)
  }
  const next: Snapshot = { at: await $.clock.now(), ...heavy, prs, boardAgeMin, main, errors }
  await update($, snap, () => next)
  await update($, busy, () => false)
  $.ui.status(statusLine(next))
}

async function recount($: EngineInterface): Promise<void> {
  if (root === null) return
  await update($, busy, () => true)
  let next: Trees
  try {
    // Read-only preview: no --execute, so nothing is removed.
    const ran = await $.process.run(['node', 'scripts/agent-os/repo-status.mjs', '--sweep'], { cwd: root, timeoutMs: SWEEP_TIMEOUT_MS })
    const counts = parseSweep(ran.stdout)
    next = {
      at: await $.clock.now(),
      counts,
      error: counts ? null : `no summary line (exit ${ran.exitCode}) ${lastLine(ran.stderr)}`.trim(),
    }
  } catch (err) {
    // repo-status.mjs --sweep has no whole-run budget of its own (slow GitHub reads add up), so a timeout is "unknown", said plainly.
    next = {
      at: await $.clock.now(),
      counts: null,
      error: `did not finish in ${SWEEP_TIMEOUT_MS / 1000} s: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  await update($, trees, () => next)
  await update($, busy, () => false)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    root = await findRoot($, e.cwd)
    // Timers first: the status line must not depend on the optional /harness command registering.
    if (root !== null) {
      $.clock.after(1_000, () => tick($))
      $.clock.every(TICK_MS, () => tick($))
    }
    try {
      await $.command.register({ name: 'harness', description: 'Open the NOURCITY harness pane and refresh it' })
    } catch (err) {
      $.ui.log(`nourcity-harness: /harness not registered (${err instanceof Error ? err.message : String(err)}); the status line still runs`)
    }

    return ran
  })

  on('command.run', { command: 'harness' }, async $ => {
    if (root === null) return { text: 'Harness: this folder is not a NOURCITY checkout (no scripts/agent-os/board.mjs).' }
    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($, true)
    const s = await read($, snap)

    return { text: s ? `Harness: ${statusLine(s)}` : 'Harness: refreshed.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, snap)
    const t = await read($, trees)
    const isBusy = await read($, busy)
    const p = await read($, playgroundState)
    const width = Math.max(24, e.props.bodyColumns ?? 40)

    if (root === null) {
      return <Text dimColor>Not a NOURCITY checkout.</Text>
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="refresh" label="Refresh" hotkey="r" variant="primary" onPress={() => refresh($, true)} />
          <Text> </Text>
          <Button key="recount" label="Count worktrees" hotkey="w" onPress={() => recount($)} />
          {isBusy && <Text dimColor> reading…</Text>}
        </Box>

        <Text bold>Machine</Text>
        {s === null ? (
          <Text dimColor>Not read yet.</Text>
        ) : (
          <Box flexDirection="column">
            <Text>RAM free: {s.ramMb === null ? "couldn't read" : `${s.ramMb} MB`}</Text>
            <Text>Heavy lease: {s.heavy ?? "couldn't read"}</Text>
            <Text>Chrome slot: {s.chrome ?? "couldn't read"}</Text>
          </Box>
        )}

        <Text bold>AI Playground</Text>
        <Box flexDirection="column">
          <Text>App: {p?.services.playground ?? 'UNKNOWN'} · Chat model: {p?.services.llamaCpp ?? 'UNKNOWN'}</Text>
          <Text>Core Services: {p?.services.coreServices ?? 'UNKNOWN'} · Home Agent: {p?.services.homeAgent ?? 'UNKNOWN'}</Text>
          <Text>MCP config: {p?.mcp.status ?? 'UNKNOWN'}{p?.mcp.status === 'OK' ? ` (${p.mcp.count} configured ${p.mcp.count === 1 ? 'server' : 'servers'})` : ''}</Text>
          <Text>Image: {p?.services.comfyui ?? 'UNKNOWN'} · OpenVINO: {p?.services.openvino ?? 'UNKNOWN'}</Text>
          <Text>Speech: TTS {p?.services.tts ?? 'UNKNOWN'} · Whisper {p?.services.whisper ?? 'UNKNOWN'}</Text>
        </Box>
        <Box>
          <Button key="start-playground" label="Start Playground" hotkey="p" onPress={() => playgroundAction($, 'start')} />
          <Text> </Text>
          <Button key="repair-media" label="Open Playground for media" hotkey="m" onPress={() => playgroundAction($, 'open')} />
        </Box>

        <Text bold>Open PRs{s?.boardAgeMin != null ? ` (board ${s.boardAgeMin} min old)` : ''}</Text>
        {s === null ? (
          <Text dimColor>Not read yet.</Text>
        ) : s.prs === null ? (
          <Text color="red">Couldn't read the PR list.</Text>
        ) : s.prs.length === 0 ? (
          <Text dimColor>No open PRs.</Text>
        ) : (
          <Box flexDirection="column">
            {s.prs.map(pr => (
              <Text color={checkWord(pr.checks) === 'red' ? 'red' : undefined}>
                #{pr.number} {checkWord(pr.checks)} {cut(pr.title, width - 18)}
              </Text>
            ))}
          </Box>
        )}

        <Text bold>Main</Text>
        <Text dimColor={s?.main == null}>{s === null ? 'Not read yet.' : s.main ? cut(s.main, width) : "Couldn't read."}</Text>

        <Text bold>Worktrees</Text>
        {t === null ? (
          <Text dimColor>Not counted yet. Press Count worktrees (about 25 s).</Text>
        ) : t.counts === null ? (
          <Text color="red">Couldn't count: {cut(t.error ?? 'unknown', width - 16)}</Text>
        ) : (
          <Text>
            {Object.entries(t.counts)
              .filter(([name]) => name !== 'removed')
              .map(([name, n]) => `${name} ${n}`)
              .join(' · ')}
          </Text>
        )}

        {s !== null && s.errors.length > 0 && (
          <Box flexDirection="column">
            <Text bold color="red">Read errors</Text>
            {s.errors.map(err => (
              <Text color="red">{cut(err, width)}</Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
