import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, unlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const cli = fileURLToPath(new URL('./ai-playground.mjs', import.meta.url));
// Built at runtime so no fixture secret itself is stored in the tracked tree.
const secret = crypto.randomUUID();
const modelId = 'synthetic-model.gguf';
const names = ['datetime', 'web-search', 'fetch', 'skills', 'vault', 'browser',
  'desktop-commander', 'pdf', 'context7', 'vapi-docs', 'graphify'];
function fixture() {
  return { mcpServers: Object.fromEntries(names.map((name, i) => [name, i < 8
    ? { displayName: name, description: 'fixture', command: 'node', args: [`${name}.mjs`],
      ...(name === 'vault' ? { env: { VAULT: secret } } : {}) }
    : { displayName: name, description: 'fixture', url: `https://${name}.example/mcp` }])) };
}
async function setup(t, config = fixture(), response = { data: [{ id: modelId }] }, ready = { status: 'ok' }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'playground-bridge-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configDir = path.join(dir, 'ai-playground', 'config');
  await mkdir(configDir, { recursive: true });
  if (config !== null) await writeFile(path.join(configDir, 'mcp.json'),
    typeof config === 'string' ? config : JSON.stringify(config));
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/health' ? ready : response));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  return { dir, configDir, endpoint, server,
    output: path.join(configDir, 'opencode.playground.json') };
}
async function run(f, args, extra = {}) {
  if (!extra.native) {
    const { main } = await bridge();
    let stdout = '';
    const code = await main([...args, '--endpoint', f.endpoint], {
      env: { ...process.env, LOCALAPPDATA: f.dir }, write: x => { stdout += x; },
      runtime: async () => ({ playground: 'UNKNOWN', ports: [] }),
    });
    return { code, stdout, stderr: '' };
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args, '--endpoint', f.endpoint], {
      env: { ...process.env, LOCALAPPDATA: f.dir }, windowsHide: true,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', x => { stdout += x; });
    child.stderr.on('data', x => { stderr += x; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}
function receipt(result) {
  assert.equal(result.stdout.includes(secret), false, 'stdout leaked private value');
  assert.equal(result.stderr.includes(secret), false, 'stderr leaked private value');
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}
async function bridge() {
  const module = await import('./ai-playground.mjs').catch(() => ({}));
  assert.equal(typeof module.main, 'function', 'bridge main must exist');
  return module;
}

test('configure mirrors all eleven MCPs, exact model and V2 provider without approvals', async t => {
  const f = await setup(t);
  const result = await run(f, ['configure', '--json'], { native: true });
  assert.equal(result.code, 0, result.stdout);
  assert.equal(receipt(result).status, 'OK');
  const config = JSON.parse(await readFile(f.output, 'utf8'));
  assert.deepEqual(Object.keys(config.mcp.servers), names);
  for (const name of names.slice(0, 8)) {
    assert.equal(config.mcp.servers[name].type, 'local');
    assert.deepEqual(config.mcp.servers[name].command, ['node', `${name}.mjs`]);
    assert.equal(config.mcp.servers[name].disabled, false);
  }
  for (const name of names.slice(8)) assert.deepEqual(config.mcp.servers[name], {
    type: 'remote', url: `https://${name}.example/mcp`, disabled: false,
  });
  assert.deepEqual(config.mcp.servers.vault.environment, { VAULT: secret });
  assert.equal(config.model, 'ai-playground/companion');
  assert.deepEqual(config.instructions, [path.join(path.dirname(cli), 'AI-PLAYGROUND-INSTRUCTIONS.md')]);
  assert.equal(config.providers['ai-playground'].package, '@opencode/ai/providers/openai-compatible');
  assert.equal(config.providers['ai-playground'].settings.baseURL, `${f.endpoint}/v1`);
  assert.equal(config.providers['ai-playground'].models.companion.modelID, modelId);
  assert.equal(config.providers['ai-playground'].models.companion.capabilities.tools, true);
  assert.equal(config.permission, undefined);
  assert.equal(config.permissions, undefined);
  assert.equal(config.policies, undefined);
  assert.deepEqual(await readdir(f.configDir), ['mcp.json', 'opencode.playground.json']);
});

test('abliterated Qwen gets a fast alias on the same model ID with thinking disabled', async t => {
  const qwenId = 'Huihui-Qwen3.5-9B-abliterated.Q4_K_M.gguf';
  const f = await setup(t, fixture(), { data: [{ id: qwenId }] });
  const { inspectHealth, configure } = await bridge();
  const result = await inspectHealth({ env: { LOCALAPPDATA: f.dir }, endpoint: f.endpoint,
    runtime: async () => ({ playground: 'OFF', ports: [] }) });
  assert.equal(result.health.status, 'OK', JSON.stringify(result.health));
  await configure(result, { LOCALAPPDATA: f.dir }, {
    writePrivate: async (filePath, payload) => writeFile(filePath, payload),
  });
  const config = JSON.parse(await readFile(f.output, 'utf8'));
  const models = config.providers['ai-playground'].models;
  assert.equal(config.model, 'ai-playground/companion-fast');
  assert.equal(models.companion.modelID, qwenId);
  assert.equal(models['companion-fast'].modelID, qwenId);
  assert.deepEqual(models['companion-fast'].body, {
    chat_template_kwargs: { enable_thinking: false },
  });
  assert.equal(models.companion.limit, undefined);
  assert.equal(models['companion-fast'].limit, undefined);
  assert.equal(result.health.modelId, qwenId);
});

test('abliterated Qwen model IDs without the GGUF suffix still select the fast alias', async t => {
  const qwenId = 'Huihui-Qwen3.5-9B-abliterated.Q4_K_M';
  const f = await setup(t, fixture(), { data: [{ id: qwenId }] });
  const { inspectHealth, configure } = await bridge();
  const result = await inspectHealth({ env: { LOCALAPPDATA: f.dir }, endpoint: f.endpoint,
    runtime: async () => ({ playground: 'OFF', ports: [] }) });
  assert.equal(result.health.status, 'OK', JSON.stringify(result.health));
  await configure(result, { LOCALAPPDATA: f.dir }, {
    writePrivate: async (filePath, payload) => writeFile(filePath, payload),
  });
  const config = JSON.parse(await readFile(f.output, 'utf8'));
  const models = config.providers['ai-playground'].models;
  assert.equal(config.model, 'ai-playground/companion-fast');
  assert.equal(models['companion-fast'].modelID, qwenId);
  assert.deepEqual(models['companion-fast'].body, {
    chat_template_kwargs: { enable_thinking: false },
  });
});

test('default abliterated launch pins the fast alias in OpenCode inline config', async t => {
  const qwenId = 'Huihui-Qwen3.5-9B-abliterated.Q4_K_M.gguf';
  const f = await setup(t, fixture(), { data: [{ id: qwenId }] });
  const { main } = await bridge();
  let invocation;
  const code = await main(['opencode', '--endpoint', f.endpoint, '--', 'run', 'test'], {
    env: { ...process.env, LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '' },
    runtime: async () => ({ playground: 'OFF', ports: [] }),
    writePrivate: async (filePath, payload) => writeFile(filePath, payload),
    launch: async (_command, _args, options) => {
      const generated = JSON.parse(await readFile(options.env.OPENCODE_CONFIG, 'utf8'));
      invocation = { model: generated.model, inline: JSON.parse(options.env.OPENCODE_CONFIG_CONTENT) };
      return 0;
    },
    opencodeVersion: async () => '2.0.0',
  });
  assert.equal(code, 0);
  assert.equal(invocation.model, 'ai-playground/companion-fast');
  assert.equal(invocation.inline.model, 'ai-playground/companion-fast');
});

test('health is read-only, reports names only and keeps unrelated readiness unknown', async t => {
  const f = await setup(t);
  const result = await run(f, ['health', '--json'], { native: true });
  assert.equal(result.code, 0);
  const health = receipt(result);
  assert.equal(health.schemaVersion, 1);
  assert.equal(health.status, 'OK');
  assert.equal(health.services.llamaCpp, 'OK');
  assert.equal(health.services.whisper, 'UNKNOWN');
  assert.equal(health.services.tts, 'UNKNOWN');
  assert.deepEqual(health.mcp, { status: 'OK', names });
  assert.equal(health.modelId, modelId);
  assert.deepEqual(Object.keys(health).sort(), ['mcp', 'modelId', 'schemaVersion', 'services', 'status']);
  assert.equal(result.stdout.includes(f.dir), false);
  assert.equal(result.stdout.includes(f.endpoint), false);
  assert.deepEqual(await readdir(f.configDir), ['mcp.json']);
});

for (const [label, config] of [
  ['missing file', null], ['invalid JSON', `{ "private": "${secret}"`],
  ['missing mcpServers', {}], ['empty servers', { mcpServers: {} }],
  ['array servers', { mcpServers: [] }],
  ['bad last server', { mcpServers: { ...fixture().mcpServers, broken: { command: 42 } } }],
  ['unsupported transport', { mcpServers: { bad: { type: 'websocket', url: 'https://a.example' } } }],
  ['nonstring env', { mcpServers: { bad: { command: 'node', env: { TOKEN: 42 } } } }],
  ['conflicting command and URL', { mcpServers: { bad: { command: 'node', url: 'https://a.example' } } }],
]) test(`malformed config fails closed: ${label}`, async t => {
  const f = await setup(t, config);
  const health = receipt(await run(f, ['health', '--json']));
  assert.equal(health.status, 'UNAVAILABLE');
  assert.deepEqual(health.mcp, { status: 'UNAVAILABLE', names: [] });
  const result = await run(f, ['configure', '--json']);
  assert.equal(result.code, 1);
  assert.equal(receipt(result).status, 'UNAVAILABLE');
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});

for (const [label, response] of [
  ['zero models', { data: [] }], ['multiple models', { data: [{ id: 'one' }, { id: 'two' }] }],
  ['invalid data', { models: [{ id: 'one' }] }], ['empty model ID', { data: [{ id: '' }] }],
  ['invalid model item', { data: [null] }],
]) test(`model discovery fails closed: ${label}`, async t => {
  const f = await setup(t, fixture(), response);
  const health = receipt(await run(f, ['health', '--json']));
  assert.equal(health.services.llamaCpp, 'UNKNOWN');
  assert.equal(health.modelId, null);
  assert.equal(health.status, 'UNKNOWN');
  assert.equal((await run(f, ['configure', '--json'])).code, 1);
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});

test('endpoint down refuses configure and leaves existing override untouched', async t => {
  const f = await setup(t);
  await new Promise(resolve => f.server.close(resolve));
  await writeFile(f.output, 'previous-good-config');
  const health = receipt(await run(f, ['health', '--json']));
  assert.equal(health.services.llamaCpp, 'UNAVAILABLE');
  assert.equal(health.modelId, null);
  const result = await run(f, ['configure', '--json']);
  assert.equal(result.code, 1);
  receipt(result);
  assert.equal(await readFile(f.output, 'utf8'), 'previous-good-config');
});

test('disabled entries and remote headers stay local with enablement preserved', async t => {
  const config = fixture();
  config.mcpServers.datetime.disabled = true;
  config.mcpServers.datetime.timeout = 45000;
  config.mcpServers.context7.timeout = 60000;
  config.mcpServers.context7.headers = { Authorization: secret };
  const f = await setup(t, config);
  const result = await run(f, ['configure', '--json']);
  assert.equal(result.code, 0);
  receipt(result);
  const generated = JSON.parse(await readFile(f.output, 'utf8'));
  assert.equal(generated.mcp.servers.datetime.disabled, true);
  assert.deepEqual(generated.mcp.servers.datetime.timeout, {
    startup: 45000, catalog: 45000, execution: 45000,
  });
  assert.deepEqual(generated.mcp.servers.context7.headers, { Authorization: secret });
  assert.deepEqual(generated.mcp.servers.context7.timeout, {
    startup: 60000, catalog: 60000, execution: 60000,
  });
});

test('health cannot echo a private env value masquerading as the model ID', async t => {
  const f = await setup(t, fixture(), { data: [{ id: secret }] });
  const result = await run(f, ['health', '--json']);
  assert.equal(result.code, 0);
  assert.equal(receipt(result).modelId, null);
  assert.equal((await run(f, ['configure', '--json'])).code, 1);
});

test('opencode consumer receives local override, preserves inline policies, and uses caller cwd', async t => {
  const f = await setup(t);
  const { main } = await bridge();
  const project = path.join(f.dir, 'project');
  await mkdir(project);
  const out = [];
  let invocation;
  const callerInline = { permission: { bash: 'deny', edit: 'ask' }, model: 'untrusted/remote' };
  const code = await main(['opencode', '--endpoint', f.endpoint, '--', 'run', 'test'], {
    env: { ...process.env, LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '',
      OPENCODE_CONFIG_CONTENT: JSON.stringify(callerInline) }, cwd: project, write: x => out.push(x),
    runtime: async () => ({ playground: 'OFF', ports: [] }),
    launch: async (command, args, options) => {
      const consumed = JSON.parse(await readFile(options.env.OPENCODE_CONFIG, 'utf8'));
      invocation = { command, args, cwd: options.cwd, consumed, configContent: options.env.OPENCODE_CONFIG_CONTENT };
      return 7;
    },
    opencodeVersion: async () => '2.0.0',
  });
  assert.equal(code, 7);
  assert.equal(invocation.command, 'opencode');
  assert.deepEqual(invocation.args, ['--standalone', 'run', 'test']);
  assert.deepEqual(JSON.parse(invocation.configContent), {
    ...callerInline, model: 'ai-playground/companion',
  });
  assert.deepEqual(JSON.parse(invocation.configContent).permission, callerInline.permission);
  assert.equal(invocation.cwd, project);
  assert.deepEqual(Object.keys(invocation.consumed.mcp.servers), names);
  assert.equal(out.join('').includes(secret), false);
});

test('thinking option keeps the same local Companion model and selects the reasoning alias', async t => {
  const qwenId = 'Huihui-Qwen3.5-9B-abliterated.Q4_K_M.gguf';
  const f = await setup(t, fixture(), { data: [{ id: qwenId }] });
  const { main } = await bridge();
  let invocation;
  const code = await main(['opencode', '--endpoint', f.endpoint, '--thinking', '--', 'run', 'test'], {
    env: { ...process.env, LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '' },
    runtime: async () => ({ playground: 'OFF', ports: [] }),
    writePrivate: async (filePath, payload) => writeFile(filePath, payload),
    launch: async (_command, _args, options) => {
      const generated = JSON.parse(await readFile(options.env.OPENCODE_CONFIG, 'utf8'));
      invocation = { model: generated.model, models: generated.providers['ai-playground'].models,
        inline: JSON.parse(options.env.OPENCODE_CONFIG_CONTENT) };
      return 0;
    },
    opencodeVersion: async () => '2.0.0',
  });
  assert.equal(code, 0);
  assert.equal(invocation.model, 'ai-playground/companion-fast');
  assert.equal(invocation.inline.model, 'ai-playground/companion');
  assert.equal(invocation.models.companion.modelID, qwenId);
  assert.equal(invocation.models['companion-fast'].modelID, qwenId);
});

test('invalid inherited OpenCode inline config fails closed before launch', async t => {
  const f = await setup(t);
  const { main } = await bridge();
  let launched = false;
  const out = [];
  const code = await main(['opencode', '--endpoint', f.endpoint, '--', 'run', 'test'], {
    env: { ...process.env, LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '',
      OPENCODE_CONFIG_CONTENT: '{private malformed policy' },
    runtime: async () => ({ playground: 'OFF', ports: [] }),
    launch: async () => { launched = true; return 0; },
    opencodeVersion: async () => '2.0.0',
    write: value => out.push(value),
  });
  assert.equal(code, 1);
  assert.equal(launched, false);
  assert.deepEqual(JSON.parse(out.join('')), { schemaVersion: 1, status: 'UNAVAILABLE' });
});

test('default coding launch keeps every MCP configured without starting any MCP server', async t => {
  const f = await setup(t);
  const { main } = await bridge();
  let generated;
  const code = await main(['opencode', '--endpoint', f.endpoint, '--', 'run', 'test'], {
    env: { ...process.env, LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '' },
    runtime: async () => ({ playground: 'OFF', ports: [] }),
    launch: async (_command, _args, options) => {
      generated = JSON.parse(await readFile(options.env.OPENCODE_CONFIG, 'utf8'));
      return 0;
    },
    opencodeVersion: async () => '2.0.0',
  });
  assert.equal(code, 0);
  assert.deepEqual(Object.keys(generated.mcp.servers), names);
  const enabled = Object.entries(generated.mcp.servers).filter(([, entry]) => !entry.disabled).map(([name]) => name);
  assert.deepEqual(enabled, []);
  assert.ok(Object.values(generated.mcp.servers).every(entry => !Object.hasOwn(entry, 'enabled')));
});

test('coding launch can opt in to an additional MCP without dropping the configured catalog', async t => {
  const f = await setup(t);
  const { main } = await bridge();
  let generated;
  const code = await main(['opencode', '--endpoint', f.endpoint, '--mcp', 'pdf', '--mcp', 'desktop-commander', '--', 'run', 'test'], {
    env: { ...process.env, LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '' },
    runtime: async () => ({ playground: 'OFF', ports: [] }),
    launch: async (_command, _args, options) => {
      generated = JSON.parse(await readFile(options.env.OPENCODE_CONFIG, 'utf8'));
      return 0;
    },
    opencodeVersion: async () => '2.0.0',
  });
  assert.equal(code, 0);
  assert.deepEqual(Object.keys(generated.mcp.servers), names);
  assert.deepEqual(Object.entries(generated.mcp.servers).filter(([, entry]) => !entry.disabled).map(([name]) => name),
    ['desktop-commander', 'pdf']);
});

test('explicitly requested disabled MCP fails instead of silently staying disabled', async t => {
  const config = fixture();
  config.mcpServers.pdf.disabled = true;
  const f = await setup(t, config);
  const { main } = await bridge();
  let launches = 0;
  const out = [];
  const code = await main(['opencode', '--endpoint', f.endpoint, '--mcp', 'pdf'], {
    env: { ...process.env, LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '' }, write: value => out.push(value),
    runtime: async () => ({ playground: 'OFF', ports: [] }),
    launch: async () => { launches++; return 0; },
    opencodeVersion: async () => '2.0.0',
  });
  assert.equal(code, 1);
  assert.equal(launches, 0);
  assert.deepEqual(await readdir(f.configDir), ['mcp.json']);
});

test('alternate model IDs do not inherit Companion token limits', async t => {
  const f = await setup(t, fixture(), { data: [{ id: 'alternate-local-model.gguf' }] });
  const result = await run(f, ['configure', '--json']);
  assert.equal(result.code, 0);
  const generated = JSON.parse(await readFile(f.output, 'utf8'));
  assert.equal(generated.providers['ai-playground'].models.companion.modelID, 'alternate-local-model.gguf');
  assert.equal(Object.hasOwn(generated.providers['ai-playground'].models.companion, 'limit'), false);
});

test('local GGUF path IDs publish only the filename while configure keeps the exact server ID', async t => {
  const id = 'C:\\Users\\Public\\AI Playground\\ai-playground\\fixture\\model.gguf';
  const f = await setup(t, fixture(), { data: [{ id }] });
  const health = receipt(await run(f, ['health', '--json']));
  assert.equal(health.status, 'OK');
  assert.equal(health.modelId, 'model.gguf');
  assert.equal((await run(f, ['configure', '--json'])).code, 0);
  const generated = JSON.parse(await readFile(f.output, 'utf8'));
  assert.equal(generated.providers['ai-playground'].models.companion.modelID, id);
});

test('local GGUF path IDs are withheld when they contain an MCP credential', async t => {
  const id = `C:\\Users\\Public\\${secret}\\model.gguf`;
  const f = await setup(t, fixture(), { data: [{ id }] });
  const health = receipt(await run(f, ['health', '--json']));
  assert.equal(health.services.llamaCpp, 'UNKNOWN');
  assert.equal(health.modelId, null);
  assert.equal((await run(f, ['configure', '--json'])).code, 1);
  assert.equal((await readFile(f.output, 'utf8').catch(() => '')).includes(secret), false);
});

test('a short credential remains blocked even when it matches a public model path component', async t => {
  const config = fixture();
  config.mcpServers.vault.args = ['--token=ai-playground'];
  const id = 'C:\\Users\\Public\\ai-playground\\model.gguf';
  const f = await setup(t, config, { data: [{ id }] });
  const health = receipt(await run(f, ['health', '--json']));
  assert.equal(health.services.llamaCpp, 'UNKNOWN');
  assert.equal(health.modelId, null);
});

test('an interrupted OpenCode child exits through cleanup and removes its private run config', async t => {
  const f = await setup(t);
  const { main } = await bridge();
  const signalTarget = new EventEmitter();
  let child;
  let kills = 0;
  const processCode = main(['opencode', '--endpoint', f.endpoint, '--', 'run', 'test'], {
    env: { ...process.env, LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '' },
    runtime: async () => ({ playground: 'OFF', ports: [] }),
    opencodeVersion: async () => '2.0.0', signalTarget, platform: 'win32',
    spawnProcess: () => {
      child = new EventEmitter();
      child.kill = () => { kills++; return true; };
      // The Windows console delivers Ctrl+C to attached child processes too.
      signalTarget.once('SIGINT', () => queueMicrotask(() => child.emit('exit', null, 'SIGINT')));
      return child;
    },
  });
  while (!child) await new Promise(resolve => setTimeout(resolve, 2));
  const files = await readdir(f.configDir);
  const configPath = path.join(f.configDir, files.find(name => name.startsWith('opencode.playground.')));
  assert.equal((await readFile(configPath, 'utf8')).includes(secret), true);
  signalTarget.emit('SIGINT');
  assert.equal(await processCode, 130);
  assert.equal(kills, 0, 'Windows Ctrl+C must not use Node child.kill() force termination');
  assert.deepEqual(await readdir(f.configDir), ['mcp.json']);
  assert.equal(signalTarget.listenerCount('SIGINT'), 0);
  assert.equal(signalTarget.listenerCount('SIGTERM'), 0);
});

test('an interrupt during private config writing waits for completion then deletes the file without launching', async t => {
  const f = await setup(t);
  const { main } = await bridge();
  const signalTarget = new EventEmitter();
  let launches = 0;
  const out = [];
  const code = await main(['opencode', '--endpoint', f.endpoint, '--', 'run', 'test'], {
    env: { ...process.env, LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '' }, write: x => out.push(x),
    runtime: async () => ({ playground: 'OFF', ports: [] }),
    opencodeVersion: async () => '2.0.0', signalTarget,
    writePrivate: async (file, payload) => {
      await writeFile(file, payload, { mode: 0o600, flag: 'wx' });
      signalTarget.emit('SIGINT');
    },
    launch: async () => { launches++; return 0; },
  });
  assert.equal(code, 130);
  assert.equal(launches, 0);
  assert.equal(out.join('').includes(secret), false);
  assert.deepEqual(await readdir(f.configDir), ['mcp.json']);
  assert.equal(signalTarget.listenerCount('SIGINT'), 0);
  assert.equal(signalTarget.listenerCount('SIGTERM'), 0);
});

test('default coding profile tolerates optional MCP servers absent from the installed catalog', async t => {
  const config = fixture();
  delete config.mcpServers.vault;
  delete config.mcpServers['desktop-commander'];
  const f = await setup(t, config);
  const { main } = await bridge();
  let generated;
  const code = await main(['opencode', '--endpoint', f.endpoint, '--', 'run', 'test'], {
    env: { ...process.env, LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '' },
    runtime: async () => ({ playground: 'OFF', ports: [] }),
    launch: async (_command, _args, options) => {
      generated = JSON.parse(await readFile(options.env.OPENCODE_CONFIG, 'utf8'));
      return 0;
    },
    opencodeVersion: async () => '2.0.0',
  });
  assert.equal(code, 0);
  assert.deepEqual(Object.keys(generated.mcp.servers), names.filter(name => !['vault', 'desktop-commander'].includes(name)));
  assert.deepEqual(Object.entries(generated.mcp.servers).filter(([, entry]) => !entry.disabled).map(([name]) => name), []);
});

test('simultaneous coding launches get isolated immutable config paths and clean them up', async t => {
  const f = await setup(t);
  const { main } = await bridge();
  const invocations = [];
  const run = name => main(['opencode', '--endpoint', f.endpoint, '--mcp', name, '--', 'run', 'test'], {
    env: { ...process.env, LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '' },
    runtime: async () => ({ playground: 'OFF', ports: [] }),
    launch: async (_command, _args, options) => {
      const configPath = options.env.OPENCODE_CONFIG;
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      invocations.push({ configPath, config });
      await new Promise(resolve => setTimeout(resolve, 20));
      return 0;
    },
    opencodeVersion: async () => '2.0.0',
  });
  assert.deepEqual(await Promise.all([run('pdf'), run('vapi-docs')]), [0, 0]);
  assert.equal(new Set(invocations.map(item => item.configPath)).size, 2);
  for (const server of ['pdf', 'vapi-docs']) {
    const invocation = invocations.find(item => !item.config.mcp.servers[server].disabled);
    assert.ok(invocation, `${server} should remain in its own launch profile`);
    assert.deepEqual(Object.entries(invocation.config.mcp.servers).filter(([, entry]) => !entry.disabled).map(([name]) => name),
      [server]);
  }
  assert.deepEqual(await readdir(f.configDir), ['mcp.json']);
});

test('unknown MCP selection fails before config generation or launch', async t => {
  const f = await setup(t);
  const { main } = await bridge();
  let launches = 0;
  const out = [];
  const code = await main(['opencode', '--endpoint', f.endpoint, '--mcp', 'unknown-tool'], {
    env: { ...process.env, LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '' },
    write: value => out.push(value),
    runtime: async () => ({ playground: 'OFF', ports: [] }),
    launch: async () => { launches++; return 0; },
    opencodeVersion: async () => '2.0.0',
  });
  assert.equal(code, 1);
  assert.equal(launches, 0);
  assert.equal(out.join('').includes(secret), false);
  assert.deepEqual(await readdir(f.configDir), ['mcp.json']);
});

test('missing or pre-V2 OpenCode refuses launch with official install route', async t => {
  const f = await setup(t);
  const { main } = await bridge();
  for (const version of [null, '1.18.27']) {
    const out = [];
    const code = await main(['opencode', '--endpoint', f.endpoint], {
      env: { ...process.env, LOCALAPPDATA: f.dir }, write: x => out.push(x),
      opencodeVersion: async () => version,
      launch: async () => assert.fail('must not launch incompatible OpenCode'),
    });
    assert.equal(code, 1);
    assert.match(out.join(''), /https:\/\/opencode.ai\/download/);
    assert.equal(out.join('').includes(secret), false);
  }
});

test('explicit start and open invoke only the installed app and never write config', async t => {
  const f = await setup(t);
  const { main } = await bridge();
  for (const action of ['start', 'open']) {
    const out = [];
    let opens = 0;
    const code = await main([action, '--json'], {
      env: { ...process.env, LOCALAPPDATA: f.dir }, write: x => out.push(x),
      openApp: async () => { opens++; },
    });
    assert.equal(code, 0);
    assert.equal(opens, 1);
    assert.deepEqual(JSON.parse(out.join('')), { schemaVersion: 1, status: 'OK' });
  }
  assert.deepEqual(await readdir(f.configDir), ['mcp.json']);
});

test('invalid endpoint and unknown arguments are redacted and never launch anything', async t => {
  const f = await setup(t);
  for (const args of [['health', '--endpoint', `https://${secret}.example`], ['oops', secret]]) {
    const { main } = await bridge();
    const out = [];
    const code = await main(args, { env: { ...process.env, LOCALAPPDATA: f.dir }, write: x => out.push(x) });
    assert.equal(code, 1);
    assert.equal(out.join('').includes(secret), false);
  }
});

test('malformed MCP config cannot bypass model redaction through a partially parsed env', async t => {
  const config = fixture();
  config.mcpServers.broken = { command: 42 };
  const f = await setup(t, config, { data: [{ id: secret }] });
  const health = receipt(await run(f, ['health', '--json']));
  assert.equal(health.modelId, null);
});

test('a wrong health schema never becomes ready merely because models exist', async t => {
  const f = await setup(t, fixture(), { data: [{ id: modelId }] }, { ready: true });
  const health = receipt(await run(f, ['health', '--json']));
  assert.equal(health.services.llamaCpp, 'UNKNOWN');
  assert.equal(health.modelId, null);
  assert.equal((await run(f, ['configure', '--json'])).code, 1);
});

test('multiple discovered llama ports stay unknown instead of picking one', async t => {
  const f = await setup(t);
  const { main } = await bridge();
  const out = [];
  assert.equal(await main(['health', '--json'], {
    env: { ...process.env, LOCALAPPDATA: f.dir }, write: x => out.push(x),
    runtime: async () => ({ playground: 'OK', ports: [39100, 39101] }),
  }), 0);
  const health = JSON.parse(out.join(''));
  assert.equal(health.services.llamaCpp, 'UNKNOWN');
  assert.equal(health.modelId, null);
});

test('configure refuses a local-data directory in a repository', async t => {
  const f = await setup(t);
  await mkdir(path.join(f.dir, '.git'));
  const result = await run(f, ['configure', '--json']);
  assert.equal(result.code, 1);
  assert.equal(receipt(result).status, 'UNAVAILABLE');
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});

test('explicit app action failure never leaks native private error text', async t => {
  const f = await setup(t);
  const { main } = await bridge();
  const out = [];
  assert.equal(await main(['start', '--json'], {
    env: { ...process.env, LOCALAPPDATA: f.dir }, write: x => out.push(x),
    openApp: async () => { throw new Error(secret); },
  }), 1);
  assert.equal(out.join('').includes(secret), false);
  assert.deepEqual(JSON.parse(out.join('')), { schemaVersion: 1, status: 'UNAVAILABLE' });
});

test('Windows npm shim resolves to the official native binary without a command shell', async t => {
  if (process.platform !== 'win32') return t.skip('Windows npm layout');
  const f = await setup(t);
  const executable = path.join(f.dir, 'npm', 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, 'synthetic binary boundary');
  const { main } = await bridge();
  let actualCommand;
  assert.equal(await main(['opencode', '--endpoint', f.endpoint], {
    env: { LOCALAPPDATA: f.dir, APPDATA: f.dir, PATH: '' }, write: () => {},
    opencodeVersion: async () => 'opencode v2.2.5',
    launch: async command => { actualCommand = command; return 0; },
    runtime: async () => ({ playground: 'OFF', ports: [] }),
  }), 0);
  assert.equal(actualCommand, executable);
});

for (const field of ['command', 'args', 'cwd', 'url', 'displayName', 'description']) {
  test(`private MCP ${field} cannot recur in health or configure model receipts`, async t => {
    const config = fixture();
    // Remove the pre-existing env sentinel so that it cannot hide a missing
    // guard on the field this regression is meant to exercise.
    delete config.mcpServers.vault.env;
    let value;
    if (field === 'url') {
      value = `https://mcp.example/${secret}`;
      config.mcpServers.context7.url = value;
    } else {
      value = field === 'args' ? `--token=${secret}` : `synthetic-${secret}`;
      config.mcpServers.vault[field] = field === 'args' ? [value] : value;
    }
    const f = await setup(t, config, { data: [{ id: value }] });
    for (const command of ['health', 'configure']) {
      const result = await run(f, [command, '--json']);
      assert.equal(result.code, command === 'health' ? 0 : 1);
      const health = receipt(result);
      assert.equal(health.modelId, null);
      assert.equal(health.services.llamaCpp, 'UNKNOWN');
    }
    await assert.rejects(readFile(f.output), { code: 'ENOENT' });
  });
}

for (const [label, field, value, token, returnedId = token] of [
  ['URL query', 'url', `https://mcp.example/mcp?token=${secret}`, secret],
  ['URL password', 'url', `https://operator:${secret}@mcp.example/mcp`, secret],
  ['URL opaque path', 'url', `https://api.example.com/${secret}`, secret, `model-${secret}`],
  ['URL encoding', 'url', 'https://mcp.example/mcp?token=synthetic%2Dsecret', 'synthetic-secret'],
  ['argument assignment', 'args', `--token=${secret}`, secret],
  ['quoted argument', 'args', `--token="${secret}"`, secret],
  ['display name path', 'displayName', `private/${secret}/adapter`, secret],
  ['description path', 'description', `Adapter at C:\\private\\${secret}\\adapter.exe`, secret, `model-${secret}`],
  ['command path', 'command', `C:\\private\\${secret}\\adapter.exe`, secret],
  ['working folder path', 'cwd', `C:\\private\\${secret}\\working`, secret],
  ['short URL token', 'url', 'https://mcp.example/mcp?token=plum', 'plum', 'model-plum'],
  ['provider-specific URL credential', 'url', 'https://mcp.example/mcp?access=plum', 'plum', 'plum'],
  ['URL signature alias', 'url', 'https://mcp.example/mcp?sig=plum', 'plum', 'model-plum'],
  ['URL password alias', 'url', 'https://mcp.example/mcp?pwd=plum', 'plum', 'model-plum'],
  ['URL authorization code', 'url', 'https://mcp.example/mcp?code=plum', 'plum', 'model-plum'],
  ['short argument token', 'args', '--token=plum', 'plum', 'model-plum'],
  ['short display-name path token', 'displayName', 'private/plum/adapter', 'plum'],
  ['short description path token', 'description', 'Adapter at C:\\private\\plum\\adapter.exe', 'plum'],
  ['short command path token', 'command', 'C:\\private\\plum\\adapter.exe', 'plum'],
  ['short working-folder token', 'cwd', 'C:\\private\\plum\\working', 'plum'],
  ['encoded argument token', 'args', '--token=p%6Cum', 'plum', 'model-plum'],
  ['Bearer credential', 'authorization', 'Bearer plum', 'plum', 'model-plum'],
  ['long opaque description token', 'description', 'Adapter at C:\\private\\opaqueprivatecredentialvalue\\adapter.exe',
    'opaqueprivatecredentialvalue', 'model-opaqueprivatecredentialvalue'],
  ['short compound description token', 'description', 'Adapter at C:\\private\\key-petal\\adapter.exe',
    'key-petal', 'model-key-petal'],
  ['malformed URL metadata', 'description', `Adapter http://[bad/${secret}`, secret, `model-${secret}`],
  ['encoded URL metadata', 'description', 'See h%74tps://api.example.com/mcp?token=plum', 'plum', 'model-plum'],
]) test(`embedded private token cannot leak: ${label}`, async t => {
  const config = fixture();
  delete config.mcpServers.vault.env;
  const entry = ['url', 'authorization'].includes(field) ? config.mcpServers.context7 : config.mcpServers.vault;
  if (field === 'authorization') entry.headers = { Authorization: value };
  else entry[field] = field === 'args' ? [value] : value;
  const f = await setup(t, config, { data: [{ id: returnedId }] });
  const { main } = await bridge();
  for (const command of ['health', 'configure']) {
    const output = [];
    const code = await main([command, '--json', '--endpoint', f.endpoint], {
      env: { ...process.env, LOCALAPPDATA: f.dir }, write: x => output.push(x),
      runtime: async () => ({ playground: 'UNKNOWN', ports: [] }),
    });
    assert.equal(output.join('').includes(token), false, 'receipt leaked token component');
    assert.equal(code, command === 'health' ? 0 : 1);
    const health = JSON.parse(output.join(''));
    assert.equal(health.modelId, null);
    assert.equal(health.services.llamaCpp, 'UNKNOWN');
  }
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});

for (const [id, url] of [
  ['company-model.gguf', 'https://api.example.com/mcp'],
  ['my-mcp-model', 'https://api.example.com/mcp'],
  ['my-mcp-model', 'https://my-mcp-model.example/mcp'],
  ['path-mcp-model', 'https://api.example.com/path-mcp-model'],
  ['mcp', 'https://api.example.com/mcp'],
  ['json', 'https://api.example.com/mcp?format=json'],
  ['json-model', 'https://api.example.com/mcp?format=json'],
]) test(`ordinary URL components do not suppress valid model ${id}`, async t => {
  const config = fixture();
  config.mcpServers.context7.url = url;
  const f = await setup(t, config, { data: [{ id }] });
  const health = receipt(await run(f, ['health', '--json']));
  assert.equal(health.status, 'OK');
  assert.equal(health.modelId, id);
  assert.equal((await run(f, ['configure', '--json'])).code, 0);
});

for (const [label, entry] of [
  ['URL query', { url: 'https://api.example.com/mcp?token=plum' }],
  ['URL userinfo', { url: 'https://operator:plum@api.example.com/mcp' }],
  ['argument', { command: 'node', args: ['--token=plum'] }],
  ['header', { url: 'https://api.example.com/mcp', headers: { Authorization: 'Bearer plum' } }],
  ['environment', { command: 'node', env: { TOKEN: 'plum' } }],
  ['metadata assignment', { command: 'node', description: 'api_key=plum' }],
]) test(`credential in a later entry cannot leak through an earlier server name: ${label}`, async t => {
  const config = fixture();
  config.mcpServers = { 'plum-reader': { command: 'node', args: ['reader.mjs'] },
    ...config.mcpServers, final: entry };
  const f = await setup(t, config);
  for (const command of ['health', 'configure']) {
    const result = await run(f, [command, '--json']);
    assert.equal(result.stdout.includes('plum'), false, 'server-name receipt leaked credential');
    assert.equal(result.code, command === 'health' ? 0 : 1);
    assert.deepEqual(receipt(result).mcp, { status: 'UNAVAILABLE', names: [] });
  }
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});

async function readyResult(f) {
  const { inspectHealth } = await bridge();
  return inspectHealth({ env: { LOCALAPPDATA: f.dir }, endpoint: f.endpoint,
    runtime: async () => ({ playground: 'UNKNOWN', ports: [] }) });
}

test('configure rejects an absent app directory without creating it', async t => {
  const f = await setup(t);
  const target = path.join(f.dir, 'unused-local-data');
  await mkdir(target);
  const { configure } = await bridge();
  await assert.rejects(configure(await readyResult(f), { LOCALAPPDATA: target }));
  assert.deepEqual(await readdir(target), []);
});

test('configure rejects redirected parent before creating an absent target config directory', async t => {
  const f = await setup(t);
  const target = path.join(f.dir, 'unused-local-data');
  const outside = await mkdtemp(path.join(tmpdir(), 'playground-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(target);
  const link = path.join(target, 'ai-playground');
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const { configure } = await bridge();
    await assert.rejects(configure(await readyResult(f), { LOCALAPPDATA: target }));
    assert.deepEqual(await readdir(outside), [], 'created directory through redirected parent');
  } finally { await unlink(link); }
});

test('configure rejects a config junction even when its target remains inside local data', async t => {
  const f = await setup(t);
  const target = path.join(f.dir, 'unused-local-data');
  const actual = path.join(target, 'actual-config');
  await mkdir(actual, { recursive: true });
  await mkdir(path.join(target, 'ai-playground'));
  const link = path.join(target, 'ai-playground', 'config');
  await symlink(actual, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const { configure } = await bridge();
    await assert.rejects(configure(await readyResult(f), { LOCALAPPDATA: target }));
    assert.deepEqual(await readdir(actual), []);
  } finally { await unlink(link); }
});

test('configure rejects a junction used as the local-data root', async t => {
  const f = await setup(t);
  const link = path.join(f.dir, 'root-alias');
  await symlink(f.dir, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const { configure } = await bridge();
    await assert.rejects(configure(await readyResult(f), { LOCALAPPDATA: link }));
    await assert.rejects(readFile(f.output), { code: 'ENOENT' });
  } finally { await unlink(link); }
});

test('configure rejects an absent config directory without creating it', async t => {
  const f = await setup(t);
  const target = path.join(f.dir, 'unused-local-data');
  const app = path.join(target, 'ai-playground');
  await mkdir(app, { recursive: true });
  const { configure } = await bridge();
  await assert.rejects(configure(await readyResult(f), { LOCALAPPDATA: target }));
  assert.deepEqual(await readdir(app), []);
});

async function aclPowerShell(file, body) {
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive',
    '-EncodedCommand', Buffer.from(`$ErrorActionPreference='Stop'; ${body}`, 'utf16le').toString('base64')], {
    env: { ...process.env, AIPG_TEST_ACL_PATH: file }, windowsHide: true, timeout: 10000, maxBuffer: 65536,
  });
  return stdout.trim();
}
async function broadParent(directory) {
  await aclPowerShell(directory, String.raw`
    $user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl=New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetOwner($user); $acl.SetAccessRuleProtection($true,$false)
    foreach($id in @($user.Value,'S-1-5-18','S-1-1-0')) {
      $sid=New-Object System.Security.Principal.SecurityIdentifier($id)
      $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
      $acl.AddAccessRule($rule)
    }
    [System.IO.Directory]::SetAccessControl($env:AIPG_TEST_ACL_PATH,$acl)
  `);
}
async function privateAcl(file) {
  return JSON.parse(await aclPowerShell(file, String.raw`
    $user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $acl=[System.IO.File]::GetAccessControl($env:AIPG_TEST_ACL_PATH)
    $rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
    $allowed=@($user,'S-1-5-18') | Select-Object -Unique
    $other=@($rules | Where-Object { $_.IsInherited -or $_.AccessControlType -ne 'Allow' -or $_.IdentityReference.Value -notin $allowed })
    $missing=@($allowed | Where-Object { $id=$_; -not @($rules | Where-Object { $_.IdentityReference.Value -eq $id -and $_.FileSystemRights -eq 'FullControl' }).Count })
    @{ protected=$acl.AreAccessRulesProtected; ownerIsCurrentUser=($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $user);
       otherRules=$other.Count; missingRules=$missing.Count; ruleCount=$rules.Count } | ConvertTo-Json -Compress
  `));
}
function assertPrivateAcl(acl) {
  assert.equal(acl.protected, true);
  assert.equal(acl.ownerIsCurrentUser, true);
  assert.equal(acl.otherRules, 0);
  assert.equal(acl.missingRules, 0);
  assert.equal(acl.ruleCount, 2);
}

test('Windows credentials wait until the real empty temp file has a verified private ACL', async t => {
  if (process.platform !== 'win32') return t.skip('Windows DACL contract');
  const f = await setup(t);
  await broadParent(f.configDir);
  const module = await bridge();
  let observed = false;
  let observation;
  await module.configure(await readyResult(f), { LOCALAPPDATA: f.dir }, {
    writePrivate: (file, payload) => module.writePrivateFile(file, payload, {
      spawnProcess: (command, args, options) => {
        const child = spawn(command, args, options);
        const end = child.stdin.end.bind(child.stdin);
        child.stdin.end = data => {
          observation = (async () => {
            assert.equal((await stat(file)).size, 0, 'credential bytes preceded the ACL barrier');
            assertPrivateAcl(await privateAcl(file));
            observed = true;
            end(data);
          })();
          observation.catch(() => child.kill());
          return child.stdin;
        };
        return child;
      },
    }),
  });
  await observation;
  assert.equal(observed, true, 'writer did not enforce the ACL barrier');
  assert.equal((await readFile(f.output, 'utf8')).includes(secret), true);
  assertPrivateAcl(await privateAcl(f.output));
});

test('Windows generated config does not inherit broad Everyone access', async t => {
  if (process.platform !== 'win32') return t.skip('Windows DACL contract');
  const f = await setup(t);
  await broadParent(f.configDir);
  const result = await run(f, ['configure', '--json']);
  assert.equal(result.code, 0);
  receipt(result);
  assertPrivateAcl(await privateAcl(f.output));
});

test('Windows ACL rejection sends no credential bytes and preserves the previous config', async t => {
  if (process.platform !== 'win32') return t.skip('Windows DACL contract');
  const f = await setup(t);
  await writeFile(f.output, 'previous-config');
  const module = await bridge();
  let bytes = 0;
  const fake = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    child.stdin.on('data', data => { bytes += data.length; });
    queueMicrotask(() => {
      child.stdout.write('ACL_FAILED\n');
      child.stdout.write('ACL_READY\n');
      child.emit('close', 1);
    });
    return child;
  };
  await assert.rejects(module.configure(await readyResult(f), { LOCALAPPDATA: f.dir }, {
    writePrivate: (file, payload) => module.writePrivateFile(file, payload, { spawnProcess: fake }),
  }));
  assert.equal(bytes, 0);
  assert.equal(await readFile(f.output, 'utf8'), 'previous-config');
  assert.deepEqual(await readdir(f.configDir), ['mcp.json', 'opencode.playground.json']);
});

test('Windows rejects a real overly broad DACL before sending any credential payload', async t => {
  if (process.platform !== 'win32') return t.skip('Windows DACL contract');
  const f = await setup(t);
  await broadParent(f.configDir);
  await writeFile(f.output, 'previous-config');
  const module = await bridge();
  let bytes = 0;
  await assert.rejects(module.configure(await readyResult(f), { LOCALAPPDATA: f.dir }, {
    writePrivate: (file, payload) => module.writePrivateFile(file, payload, {
      spawnProcess: (command, args, options) => {
        const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
        const target = '$security.SetAccessRuleProtection($true,$false)';
        assert.equal(script.split(target).length - 1, 1);
        // Simulate a permissions operation granting an unexpected principal.
        // The real verification code must refuse this real insecure file.
        const tampered = script.replace(target, `${target}\n$security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'FullControl','Allow'))`);
        const child = spawn(command, [...args.slice(0, -1), Buffer.from(tampered, 'utf16le').toString('base64')], options);
        const end = child.stdin.end.bind(child.stdin);
        child.stdin.end = data => { bytes += Buffer.byteLength(data); return end(data); };
        return child;
      },
    }),
  }));
  assert.equal(bytes, 0, 'insecure ACL received credential payload');
  assert.equal(await readFile(f.output, 'utf8'), 'previous-config');
  assert.deepEqual(await readdir(f.configDir), ['mcp.json', 'opencode.playground.json']);
});

test('Windows private writer requires a completed-write acknowledgement', async t => {
  if (process.platform !== 'win32') return t.skip('Windows DACL contract');
  const f = await setup(t);
  const module = await bridge();
  const fake = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => { child.stdout.write('ACL_READY\n'); child.emit('close', 0); });
    return child;
  };
  await assert.rejects(module.writePrivateFile(path.join(f.configDir, 'unused.tmp'), secret, { spawnProcess: fake }));
});

test('Windows private writer preserves UTF-8 configuration bytes', async t => {
  if (process.platform !== 'win32') return t.skip('Windows private writer');
  const f = await setup(t);
  const module = await bridge();
  const payload = `${JSON.stringify({ value: '\u79d8\u5bc6-\ud83c\udf3f' })}\n`;
  const file = path.join(f.configDir, 'unicode.tmp');
  await module.writePrivateFile(file, payload);
  assert.deepEqual(await readFile(file), Buffer.from(payload, 'utf8'));
  assertPrivateAcl(await privateAcl(file));
});
