import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const NOW = 1_000_000_000
const PANE = {
  plugin: 'nourcity-harness',
  component: 'Pane',
  requestId: 'harness',
  props: {
    title: 'Harness',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const HEAVY = 'heavy: free\nchrome: free\nfree RAM: 5228 MB (heavy runs wait under 1500)\n'
const AI_HEALTH = JSON.stringify({
  schemaVersion: 1,
  status: 'OK',
  services: { playground: 'OK', llamaCpp: 'OK', coreServices: 'OK', homeAgent: 'OFF', comfyui: 'OK', openvino: 'OK', tts: 'OK', whisper: 'UNKNOWN' },
  modelId: 'local-model',
  mcp: { status: 'OK', names: ['browser', 'desktop-commander'] },
})
const BOARD = JSON.stringify({
  updatedMs: NOW - 120_000,
  prs: [
    { number: 3515, title: 'deps(deps): bump the prod-minor group', checks: 'FAILURE' },
    { number: 3530, title: 'docs · agent-os · machine sync contract', checks: 'SUCCESS' },
  ],
  prsError: null,
  main: [{ subject: 'deps(deps-dev): bump the dev-minor group with 8 updates (#3513)' }],
})
const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const failed = (stderr: string) => ({
  value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

type On = Parameters<TestBody>[1]

/** The engine beneath the plugin: a NOURCITY checkout, timers that never fire, and the scripts' answers. */
function engine(on: On, board: ReturnType<typeof ok> = ok(BOARD), isRepo = true, playground = () => ok(AI_HEALTH)) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.stat', () => {
    if (!isRepo) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 1, mtimeMs: NOW, isLink: false } }
  })
  on('command.register', () => ({ value: { command: 'harness' } }))
  on('clock.after', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const script = e.argv[1]
    if (script === 'tools/sovereign-dev/ai-playground.mjs') return playground(e.argv)
    if (script === 'scripts/agent-os/heavy.mjs') return ok(HEAVY)
    if (script === 'scripts/agent-os/board.mjs') return ok('')
    if (script === '-e') return board
    if (script === 'scripts/agent-os/repo-status.mjs') {
      return ok('repo:status\nLANDED 13 · OPEN_PR 0 · NO_PR 34 · DIRTY 11 · removed 0\n')
    }
    return failed(`unexpected ${script}`)
  })
}

test('Refresh shows separate local Playground, model, tools and media states without exposing the model ID', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /AI Playground/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Chat model: OK/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /MCP config: OK \(2 configured servers\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Image: OK · OpenVINO: OK/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Speech: TTS OK · Whisper UNKNOWN/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /local-model/ })).toBeUndefined()
  await ui.unmount()
})

test('malformed Playground health stays unknown', async ($, on) => {
  engine(on, ok(BOARD), true, () => ok('{bad json'))
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /Chat model: UNKNOWN/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /MCP config: UNKNOWN/ })).toBeDefined()
  await ui.unmount()
})

test('an off app and an unavailable model remain distinct', async ($, on) => {
  const offline = JSON.stringify({
    schemaVersion: 1,
    status: 'UNAVAILABLE',
    services: { playground: 'OFF', llamaCpp: 'UNAVAILABLE', coreServices: 'UNKNOWN', homeAgent: 'OFF', comfyui: 'UNAVAILABLE', openvino: 'UNKNOWN', tts: 'UNKNOWN', whisper: 'UNKNOWN' },
    modelId: null,
    mcp: { status: 'OK', names: ['browser'] },
  })
  engine(on, ok(BOARD), true, () => ok(offline))
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /App: OFF · Chat model: UNAVAILABLE/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Image: UNAVAILABLE · OpenVINO: UNKNOWN/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /MCP config: OK \(1 configured server\)/ })).toBeDefined()
  await ui.unmount()
})

test('MCP config with missing server names stays unknown instead of showing zero', async ($, on) => {
  const invalidNames = JSON.stringify({
    schemaVersion: 1,
    services: { playground: 'OK', llamaCpp: 'OK' },
    mcp: { status: 'OK' },
  })
  engine(on, ok(BOARD), true, () => ok(invalidNames))
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /MCP config: UNKNOWN/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /MCP config: OK \(0 configured servers\)/ })).toBeUndefined()
  await ui.unmount()
})

test('MCP config with an empty server list stays unknown', async ($, on) => {
  const emptyNames = JSON.stringify({ schemaVersion: 1, services: {}, mcp: { status: 'OK', names: [] } })
  engine(on, ok(BOARD), true, () => ok(emptyNames))
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /MCP config: UNKNOWN/ })).toBeDefined()
  await ui.unmount()
})

test('an unavailable MCP config stays unavailable when it has no server names', async ($, on) => {
  const unavailable = JSON.stringify({ schemaVersion: 1, services: {}, mcp: { status: 'UNAVAILABLE', names: [] } })
  engine(on, ok(BOARD), true, () => ok(unavailable))
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /MCP config: UNAVAILABLE/ })).toBeDefined()
  await ui.unmount()
})

test('scheduled refresh reads Playground health but never starts it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const commands: string[][] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: NOW, isLink: false } }))
  on('command.register', () => ({ value: { command: 'harness' } }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    commands.push(e.argv)
    const script = e.argv[1]
    if (script === 'scripts/agent-os/heavy.mjs') return ok(HEAVY)
    if (script === '-e') return ok(BOARD)
    if (script === 'tools/sovereign-dev/ai-playground.mjs') return ok(AI_HEALTH)
    return ok('')
  })
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  await clock.advance(1_000)

  expect(commands.some(argv => argv[1] === 'tools/sovereign-dev/ai-playground.mjs' && argv[2] === 'health')).toBe(true)
  expect(commands.some(argv => argv[1] === 'tools/sovereign-dev/ai-playground.mjs' && argv[2] !== 'health')).toBe(false)
})

test('starting Playground is an explicit pane action', async ($, on) => {
  const commands: string[][] = []
  engine(on, ok(BOARD), true, argv => {
    commands.push(argv)
    return argv[2] === 'start' ? ok('{"schemaVersion":1,"status":"OK"}') : ok(AI_HEALTH)
  })
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'start-playground' })

  expect(commands.some(argv => argv[2] === 'start')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /AI Playground/ })).toBeDefined()
  await ui.unmount()
})

test('a late offline tick cannot overwrite the explicit start result', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let releaseOldHealth: ((value: ReturnType<typeof ok>) => void) | undefined
  let oldHealthStarted: (() => void) | undefined
  let finishRefresh: (() => void) | undefined
  const healthStarted = new Promise<void>(resolve => { oldHealthStarted = resolve })
  const refreshFinished = new Promise<void>(resolve => { finishRefresh = resolve })
  let healthCalls = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: NOW, isLink: false } }))
  on('command.register', () => ({ value: { command: 'harness' } }))
  on('ui.status', (_, e) => {
    if (String(e.text).startsWith('RAM ')) finishRefresh?.()
    return { value: undefined }
  })
  on('process.run', async (_, e) => {
    const script = e.argv[1]
    if (script === 'scripts/agent-os/heavy.mjs') return ok(HEAVY)
    if (script === 'scripts/agent-os/board.mjs') return ok('')
    if (script === '-e') return ok(BOARD)
    if (script === 'tools/sovereign-dev/ai-playground.mjs') {
      if (e.argv[2] === 'start') return ok('{"schemaVersion":1,"status":"OK"}')
      healthCalls++
      if (healthCalls === 1) {
        oldHealthStarted?.()
        return new Promise(resolve => { releaseOldHealth = resolve })
      }
      return ok(AI_HEALTH)
    }
    return failed(`unexpected ${script}`)
  })
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(1_000)
  await healthStarted
  await ui.press({ key: 'start-playground' })
  expect(await ui.find({ type: 'Text', text: /Chat model: OK/ })).toBeDefined()

  const offline = JSON.stringify({ schemaVersion: 1, services: { playground: 'OFF', llamaCpp: 'UNAVAILABLE' }, mcp: { status: 'OK', names: ['server'] } })
  releaseOldHealth?.(ok(offline))
  await refreshFinished
  expect(await ui.find({ type: 'Text', text: /App: OK · Chat model: OK/ })).toBeDefined()
  await ui.unmount()
})

test('an explicit Refresh queues behind a scheduled read instead of being dropped', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let releaseHealth: ((value: ReturnType<typeof ok>) => void) | undefined
  let markHealthStarted: (() => void) | undefined
  let markBoardRefreshed: (() => void) | undefined
  const healthStarted = new Promise<void>(resolve => { markHealthStarted = resolve })
  const boardRefreshed = new Promise<void>(resolve => { markBoardRefreshed = resolve })
  let healthCalls = 0
  let boardRefreshes = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: NOW, isLink: false } }))
  on('command.register', () => ({ value: { command: 'harness' } }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', async (_, e) => {
    if (e.argv[1] === 'scripts/agent-os/heavy.mjs') return ok(HEAVY)
    if (e.argv[1] === 'scripts/agent-os/board.mjs') {
      if (e.argv[2] === 'refresh') {
        boardRefreshes++
        markBoardRefreshed?.()
      }
      return ok('')
    }
    if (e.argv[1] === '-e') return ok(BOARD)
    if (e.argv[1] === 'tools/sovereign-dev/ai-playground.mjs') {
      healthCalls++
      if (healthCalls === 1) {
        markHealthStarted?.()
        return new Promise(resolve => { releaseHealth = resolve })
      }
      return ok(AI_HEALTH)
    }
    return failed(`unexpected ${e.argv[1]}`)
  })
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  await clock.advance(1_000)
  await healthStarted
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const pressingRefresh = ui.press({ key: 'refresh' })
  releaseHealth?.(ok(AI_HEALTH))
  await pressingRefresh
  await boardRefreshed

  expect(boardRefreshes).toBe(1)
  await ui.unmount()
})

test('media repair is an explicit action separate from scheduled health reads', async ($, on) => {
  const commands: string[][] = []
  engine(on, ok(BOARD), true, argv => {
    commands.push(argv)
    return argv[2] === 'open' ? ok('{"schemaVersion":1,"status":"OK"}') : ok(AI_HEALTH)
  })
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'repair-media' })

  expect(commands.some(argv => argv[2] === 'open')).toBe(true)
  await ui.unmount()
})

test('Refresh reads RAM, the lease and the PRs from the repo scripts', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: 'C:\\repo\\.claude\\worktrees\\w1', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect((await ui.find({ type: 'Text', text: /RAM free/ }))?.text).toBe('RAM free: 5228 MB')
  expect((await ui.find({ type: 'Text', text: /#3515/ }))?.text).toMatch(/^#3515 red /)
  expect((await ui.find({ type: 'Text', text: /#3530/ }))?.text).toMatch(/^#3530 green /)
  expect(await ui.find({ type: 'Text', text: /board 2 min old/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Read errors/ })).toBeUndefined()
  await ui.unmount()
})

test('a board that cannot be read shows as unknown, never as no PRs', async ($, on) => {
  engine(on, failed('ENOENT: no such file board.json'))
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /Couldn't read the PR list/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No open PRs/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /board: exit 1 ENOENT/ })).toBeDefined()
  await ui.unmount()
})

test('Count worktrees shows the sweep preview counts', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'recount' })

  expect((await ui.find({ type: 'Text', text: /LANDED/ }))?.text).toBe('LANDED 13 · OPEN_PR 0 · NO_PR 34 · DIRTY 11')
  await ui.unmount()
})

test('a tick while a refresh is still running starts no second refresh', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let heavyRuns = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: NOW, isLink: false } }))
  on('command.register', () => ({ value: { command: 'harness' } }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', async (_, e) => {
    const script = e.argv[1]
    if (script === 'scripts/agent-os/heavy.mjs') {
      heavyRuns++
      await clock.sleep(400_000) // slower than the 5-minute tick, so the tick lands mid-refresh
      return ok(HEAVY)
    }
    return script === '-e' ? ok(BOARD) : ok('')
  })
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })

  await clock.advance(1_000) // the first refresh starts and stays in flight
  expect(heavyRuns).toBe(1)
  await clock.advance(300_000) // the 5-minute tick fires mid-refresh: skipped
  expect(heavyRuns).toBe(1)
  await clock.advance(200_000) // the first refresh ends
  await clock.advance(300_000) // the next tick finds it idle and refreshes
  expect(heavyRuns).toBe(2)
})

test('a session started below the checkout root still finds the checkout', async ($, on) => {
  const roots: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.stat', (_, e) => {
    if (e.path.replace(/\\/g, '/') !== 'C:/repo/scripts/agent-os/board.mjs') throw new Error('ENOENT')
    return { value: { kind: 'file', size: 1, mtimeMs: NOW, isLink: false } }
  })
  on('command.register', () => ({ value: { command: 'harness' } }))
  on('clock.after', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    roots.push((e.init?.cwd ?? '').replace(/\\/g, '/'))
    return e.argv[1] === '-e' ? ok(BOARD) : ok(HEAVY)
  })
  await $.session.start({ cwd: 'C:\\repo\\apps\\statenour', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /Not a NOURCITY checkout/ })).toBeUndefined()
  await ui.press({ key: 'refresh' })
  expect(roots.length).toBeGreaterThan(0)
  expect(roots.every(r => r === 'C:/repo')).toBe(true)
  await ui.unmount()
})

test('a board whose GitHub refresh failed shows the PR list as unknown, not the cached list', async ($, on) => {
  const stale = JSON.stringify({ updatedMs: NOW, prs: [], prsError: 'gh: not logged in', main: [{ subject: 'x' }] })
  engine(on, ok(stale))
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /Couldn't read the PR list/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No open PRs/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /board PRs: gh: not logged in/ })).toBeDefined()
  await ui.unmount()
})

test('a sweep that outlasts its time shows the count as unknown and says why', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: NOW, isLink: false } }))
  on('command.register', () => ({ value: { command: 'harness' } }))
  on('clock.after', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    if (e.argv[1] === 'scripts/agent-os/repo-status.mjs') throw new Error('timed out')
    return e.argv[1] === '-e' ? ok(BOARD) : ok(HEAVY)
  })
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'recount' })

  expect((await ui.find({ type: 'Text', text: /Couldn't count/ }))?.text).toMatch(/^Couldn't count: did not finish in 300 s/)
  await ui.unmount()
})

test('a /harness name collision does not stop the status timer', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let heavyRuns = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: NOW, isLink: false } }))
  on('command.register', () => {
    throw new Error('command harness is taken')
  })
  const logs: string[] = []
  on('ui.log', (_, e) => {
    logs.push(String(e.text))
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    if (e.argv[1] === 'scripts/agent-os/heavy.mjs') heavyRuns++
    return e.argv[1] === '-e' ? ok(BOARD) : ok(HEAVY)
  })
  await $.session.start({ cwd: 'C:\\repo', surface: 'desktop', isInteractive: true })
  await clock.advance(1_000)

  expect(heavyRuns).toBe(1)
  expect(logs.join('\n')).toMatch(/\/harness not registered \(.+\); the status line still runs/)
})

test('outside a NOURCITY checkout the pane says so', async ($, on) => {
  engine(on, ok(BOARD), false)
  await $.session.start({ cwd: 'C:\\elsewhere', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('Not a NOURCITY checkout.')
  await ui.unmount()
})
