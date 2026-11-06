#!/usr/bin/env node
import { readFile, open, rename, unlink, realpath, access, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
const SCHEMA = 'https://opencode.ai/config.json';
const INSTALL = 'https://opencode.ai/download';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.trim().length > 0 && !/[\x00-\x1f]/.test(x);
const invalid = () => { throw new Error('INVALID_LOCAL_CONFIGURATION'); };
const exists = async file => access(file).then(() => true, () => false);

function stringMap(value) {
  if (!object(value) || Object.values(value).some(x => typeof x !== 'string' || x.includes('\0'))) invalid();
  return value;
}

const URL_TEXT = /https?:\/\/[^\s"'<>]+/g;
const SENSITIVE_KEY = /token|key|auth|secret|pass|pwd|sig|credential|session|bearer|jwt|code/i;
const PUBLIC_QUERY_KEY = /^(?:format|type|page|limit|offset|sort|order|direction|cursor|stream|version|include|exclude)$/i;
const decodedValue = value => { try { return decodeURIComponent(value); } catch { return value; } };
const CODING_MCP_SERVERS = new Set();
const LOCAL_COMPANION_MODEL = 'ai-playground/companion';
const LOCAL_COMPANION_FAST_MODEL = 'ai-playground/companion-fast';
const QWEN_ABLITERATED_FILE = 'huihui-qwen3.5-9b-abliterated.q4_k_m.gguf';

function preferredModelAlias(modelId) {
  return path.win32.basename(modelId ?? '').toLowerCase() === QWEN_ABLITERATED_FILE
    ? LOCAL_COMPANION_FAST_MODEL : LOCAL_COMPANION_MODEL;
}

function localModelInlineConfig(existing, model = LOCAL_COMPANION_MODEL) {
  if (![LOCAL_COMPANION_MODEL, LOCAL_COMPANION_FAST_MODEL].includes(model)) invalid();
  let config = {};
  if (existing !== undefined && existing !== '') {
    try { config = JSON.parse(existing); } catch { throw new Error('Invalid OpenCode inline config'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('Invalid OpenCode inline config');
    }
  }
  return JSON.stringify({ ...config, model });
}
const PUBLIC_MODEL_PATH_COMPONENTS = new Set(['ai-playground']);

function privateTokens(value, credentials) {
  const tokens = [value];
  const decoded = decodedValue(value);
  tokens.push(decoded);
  // Structured values expose credential components even when the component is
  // short. Do not use a minimum secret length for URLs or option assignments.
  const urlInput = decoded === value ? value : `${value} ${decoded}`;
  for (const match of urlInput.matchAll(URL_TEXT)) {
    try {
      const url = new URL(match[0]);
      const credentialValues = [decodedValue(url.username), decodedValue(url.password),
        ...[...url.searchParams].filter(([key]) => SENSITIVE_KEY.test(key) || !PUBLIC_QUERY_KEY.test(key))
          .map(([, part]) => part)];
      const opaqueValues = [url.hostname, url.pathname, url.hash, ...url.searchParams.values()]
        .flatMap(part => decodedValue(part).match(/[\p{L}\p{N}_-]{16,}/gu) ?? []);
      tokens.push(...credentialValues, ...opaqueValues);
      credentials.push(...credentialValues, ...opaqueValues);
    } catch {
      const opaqueValues = match[0].match(/[\p{L}\p{N}_-]{16,}/gu) ?? [];
      tokens.push(...opaqueValues);
      credentials.push(...opaqueValues);
    }
  }
  const nonUrlText = decoded.replace(URL_TEXT, ' ');
  for (const match of nonUrlText.matchAll(/(?:^|\s)(?:--?[\w-]+|[\w.-]+)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g)) {
    const credential = match[1] ?? match[2] ?? match[3];
    tokens.push(credential);
    credentials.push(credential);
  }
  for (const match of nonUrlText.matchAll(/\b(?:Bearer|Basic)\s+([^\s]+)/gi)) {
    tokens.push(match[1]);
    credentials.push(match[1]);
  }
  // Paths and prose may wrap an opaque token without an assignment marker.
  // Preserve compound tokens instead of splitting them into common words.
  tokens.push(...(nonUrlText.match(/[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+/g) ?? []));
  tokens.push(...(nonUrlText.match(/[\p{L}\p{N}_-]{16,}/gu) ?? []));
  return tokens.filter(Boolean);
}

function privateStrings(value, credentials) {
  if (typeof value === 'string') return value ? privateTokens(value, credentials) : [];
  if (Array.isArray(value) || object(value)) return Object.values(value).flatMap(item => privateStrings(item, credentials));
  return [];
}

export function mapMcp(config) {
  if (!object(config) || !object(config.mcpServers) || !Object.keys(config.mcpServers).length) invalid();
  const secrets = [];
  const mcp = Object.fromEntries(Object.entries(config.mcpServers).map(([name, entry]) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || !object(entry)) invalid();
    const local = Object.hasOwn(entry, 'command');
    const remote = Object.hasOwn(entry, 'url');
    if (local === remote) invalid();
    const allowed = ['displayName', 'description', 'type', 'enabled', 'disabled', 'timeout',
      ...(local ? ['command', 'args', 'env', 'cwd'] : ['url', 'headers'])];
    if (Object.keys(entry).some(k => !allowed.includes(k))) invalid();
    if (entry.type !== undefined && !(local ? ['stdio', 'local'] : ['sse', 'http', 'streamable-http', 'remote']).includes(entry.type)) invalid();
    for (const key of ['disabled', 'enabled']) if (entry[key] !== undefined && typeof entry[key] !== 'boolean') invalid();
    if (entry.disabled !== undefined && entry.enabled !== undefined && entry.disabled === entry.enabled) invalid();
    if (entry.timeout !== undefined && (!Number.isSafeInteger(entry.timeout) || entry.timeout <= 0)) invalid();
    const mapped = { type: local ? 'local' : 'remote' };
    if (local) {
      if (!text(entry.command) || (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some(x => typeof x !== 'string' || x.includes('\0'))))) invalid();
      mapped.command = [entry.command, ...(entry.args ?? [])];
      if (entry.env !== undefined) {
        mapped.environment = stringMap(entry.env);
        secrets.push(...Object.values(entry.env));
      }
      if (entry.cwd !== undefined) {
        if (!text(entry.cwd)) invalid();
        mapped.cwd = entry.cwd;
      }
    } else {
      if (!text(entry.url)) invalid();
      const url = new URL(entry.url);
      if (!['http:', 'https:'].includes(url.protocol)) invalid();
      mapped.url = entry.url;
      if (entry.headers !== undefined) {
        mapped.headers = stringMap(entry.headers);
        secrets.push(...Object.values(entry.headers));
      }
    }
    mapped.enabled = entry.enabled ?? !entry.disabled;
    if (entry.timeout !== undefined) mapped.timeout = entry.timeout;
    return [name, mapped];
  }));
  // The endpoint can reflect any MCP value, including paths, URL credentials,
  // command arguments, and metadata. Keep this guard set entirely in memory.
  const credentials = secrets.flatMap(value => [value, decodedValue(value)]);
  const privateValues = [...new Set(privateStrings(config.mcpServers, credentials))];
  const credentialTokens = [...new Set(credentials.filter(Boolean))];
  if (Object.keys(mcp).some(name => credentialTokens.some(token => name.includes(token)))) invalid();
  // An entire returned ID can also be a plain path/text component. Compare
  // these atoms by equality: common directory words must not match every
  // legitimate model path merely because both paths share a Windows prefix.
  const privateAtoms = new Set(privateValues.flatMap(value => value.replace(URL_TEXT, ' ')
    .split(/[\s/\\:;?&#=,"'()[\]{}<>]+/u)).filter(Boolean));
  // Path-like model IDs are common from llama.cpp. Metadata such as a display
  // name may coincide with a benign path segment; credential-bearing fields
  // and launch paths remain blocked for those IDs.
  const modelCredentials = [];
  const privateModelValues = Object.entries(config.mcpServers).flatMap(([, entry]) =>
    ['command', 'args', 'cwd', 'url', 'headers', 'env'].flatMap(key =>
      Object.hasOwn(entry, key) ? privateStrings(entry[key], modelCredentials) : []));
  return { mcp, secrets: credentialTokens, privateValues, privateModelValues: [...new Set([
    ...privateModelValues, ...modelCredentials.filter(Boolean),
  ])], privateAtoms };
}

function loopbackEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !['/', '/v1', '/v1/'].includes(url.pathname)) invalid();
  return url.origin;
}

// Only process state and numeric llama ports cross the subprocess boundary.
// Command lines may contain private paths, so they never enter a receipt.
export async function inspectRuntime() {
  if (process.platform !== 'win32') return { playground: 'UNKNOWN', ports: [] };
  try {
    const script = String.raw`
      $p = @(Get-CimInstance Win32_Process -ErrorAction Stop)
      $ports = @($p | Where-Object Name -eq 'llama-server.exe' | ForEach-Object {
        if ($_.CommandLine -match '(?:--port(?:=|\s+)|-p\s+)(\d+)') { [int]$Matches[1] }
      } | Sort-Object -Unique)
      @{ playground = $(if (@($p | Where-Object Name -eq 'AI Playground.exe').Count) { 'OK' } else { 'OFF' }); ports = $ports } | ConvertTo-Json -Compress
    `;
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 5000, maxBuffer: 65536,
    });
    const result = JSON.parse(stdout);
    if (!['OK', 'OFF'].includes(result.playground) || !Array.isArray(result.ports)
      || result.ports.some(x => !Number.isInteger(x) || x < 1 || x > 65535)) invalid();
    return result;
  } catch {
    return { playground: 'UNKNOWN', ports: [] };
  }
}

async function jsonGet(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: 'error' });
  if (!response.ok) throw new Error('ENDPOINT_UNAVAILABLE');
  // Bound the response instead of reading arbitrary server error output.
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error('INVALID_ENDPOINT_RESPONSE');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('INVALID_ENDPOINT_RESPONSE'); }
}

export async function inspectHealth({ env = process.env, endpoint, runtime = inspectRuntime } = {}) {
  const services = { playground: 'UNKNOWN', llamaCpp: 'UNKNOWN', coreServices: 'UNKNOWN', homeAgent: 'UNKNOWN',
    comfyui: 'UNKNOWN', openvino: 'UNKNOWN', tts: 'UNKNOWN', whisper: 'UNKNOWN' };
  const health = { schemaVersion: 1, status: 'UNKNOWN', services, modelId: null,
    mcp: { status: 'UNAVAILABLE', names: [] } };
  let mapped;
  try {
    if (!text(env.LOCALAPPDATA)) invalid();
    mapped = mapMcp(JSON.parse(await readFile(path.join(env.LOCALAPPDATA, 'ai-playground', 'config', 'mcp.json'), 'utf8')));
    health.mcp = { status: 'OK', names: Object.keys(mapped.mcp) };
  } catch { /* Never print a parser error or the private config path. */ }
  let running;
  try {
    running = await runtime();
    if (!object(running) || !Array.isArray(running.ports)) invalid();
  } catch { running = { playground: 'UNKNOWN', ports: [] }; }
  services.playground = ['OK', 'OFF'].includes(running.playground) ? running.playground : 'UNKNOWN';
  let baseURL;
  let configModelId;
  if (!endpoint && running.ports.length > 1) {
    health.status = health.mcp.status === 'OK' ? 'UNKNOWN' : 'UNAVAILABLE';
    return { health, mapped };
  }
  try {
    baseURL = loopbackEndpoint(endpoint ?? `http://127.0.0.1:${running.ports[0] ?? 39100}`);
    const [ready, models] = await Promise.all([jsonGet(`${baseURL}/health`), jsonGet(`${baseURL}/v1/models`)]);
    const id = object(models) && Array.isArray(models.data) && models.data.length === 1 && object(models.data[0])
      ? models.data[0].id : null;
    const isLocalModelPath = text(id) && (path.isAbsolute(id) || path.win32.isAbsolute(id));
    const privateIdMatch = mapped && text(id) && (mapped.privateAtoms.has(id)
      || (isLocalModelPath
        ? mapped.secrets.some(value => id.includes(value))
          || mapped.privateModelValues.some(value => id.includes(value) && !PUBLIC_MODEL_PATH_COMPONENTS.has(value))
        : mapped.privateValues.some(value => id.includes(value))));
    if (!object(ready) || ready.status !== 'ok' || !text(id) || privateIdMatch) throw new Error('INVALID_ENDPOINT_RESPONSE');
    services.llamaCpp = 'OK';
    // A malformed config may contain private values we could not safely collect.
    // In that case publish service state, but no server-controlled identifier.
    // Absolute model paths are represented by their basename in receipts.
    health.modelId = mapped ? (isLocalModelPath ? path.win32.basename(id) : id) : null;
    configModelId = id;
  } catch (error) {
    services.llamaCpp = error.message === 'INVALID_ENDPOINT_RESPONSE' ? 'UNKNOWN' : 'UNAVAILABLE';
  }
  health.status = health.mcp.status !== 'OK' || services.llamaCpp === 'UNAVAILABLE'
    ? 'UNAVAILABLE' : services.llamaCpp === 'OK' ? 'OK' : 'UNKNOWN';
  return { health, mapped, baseURL, modelId: configModelId };
}

async function assertOutsideRepo(directory) {
  let current = directory;
  while (true) {
    if (await exists(path.join(current, '.git'))) invalid();
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function plainDirectory(directory) {
  const absolute = path.resolve(directory);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of ['', ...absolute.slice(root.length).split(path.sep).filter(Boolean)]) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) invalid();
  }
  return realpath(absolute);
}

const WINDOWS_PRIVATE_WRITE = String.raw`
  $ErrorActionPreference='Stop'
  $ProgressPreference='SilentlyContinue'
  $stream=$null
  try {
    [Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
    $user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $allowed=@($user.Value,'S-1-5-18') | Select-Object -Unique
    $security=[System.Security.AccessControl.FileSecurity]::new()
    $security.SetOwner($user)
    $security.SetAccessRuleProtection($true,$false)
    foreach($id in $allowed) {
      $sid=[System.Security.Principal.SecurityIdentifier]::new($id)
      $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow'))
    }
    $stream=[System.IO.FileStream]::new($env:AIPG_PRIVATE_CONFIG_PATH,
      [System.IO.FileMode]::CreateNew,[System.Security.AccessControl.FileSystemRights]::FullControl,
      [System.IO.FileShare]::Read,4096,[System.IO.FileOptions]::WriteThrough,$security)
    $actual=$stream.GetAccessControl()
    $rules=@($actual.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
    if(-not $actual.AreAccessRulesProtected -or $stream.Length -ne 0 -or
       $actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $user.Value -or
       $rules.Count -ne $allowed.Count) { throw 'ACL_FAILED' }
    foreach($rule in $rules) {
      if($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or
         $rule.IdentityReference.Value -notin $allowed -or $rule.FileSystemRights -ne 'FullControl') { throw 'ACL_FAILED' }
    }
    foreach($id in $allowed) {
      if(-not @($rules | Where-Object { $_.IdentityReference.Value -eq $id }).Count) { throw 'ACL_FAILED' }
    }
    [Console]::Out.WriteLine('ACL_READY')
    [Console]::Out.Flush()
    $payload=[Console]::In.ReadToEnd()
    $bytes=[System.Text.UTF8Encoding]::new($false).GetBytes($payload)
    $stream.Write($bytes,0,$bytes.Length)
    $stream.Flush($true)
    $stream.Dispose(); $stream=$null
    [Console]::Out.WriteLine('ACL_WRITTEN')
  } catch {
    if($null -ne $stream) { $stream.Dispose() }
    [Console]::Out.WriteLine('ACL_FAILED')
    exit 1
  }
`;

export async function writePrivateFile(filePath, payload, { spawnProcess = spawn } = {}) {
  if (process.platform !== 'win32') {
    const file = await open(filePath, 'wx', 0o600);
    try { await file.writeFile(payload); await file.sync(); } finally { await file.close(); }
    return;
  }
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await new Promise((resolve, reject) => {
    const child = spawnProcess(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(WINDOWS_PRIVATE_WRITE, 'utf16le').toString('base64')], {
      env: { ...process.env, AIPG_PRIVATE_CONFIG_PATH: filePath },
      windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let ready = false, written = false, settled = false, failed = false, pending = '';
    const fail = () => {
      if (settled || failed) return;
      failed = true;
      clearTimeout(timer);
      child.kill();
    };
    const timer = setTimeout(fail, 10000);
    child.once('error', fail);
    child.stdin.on('error', fail);
    child.stderr.on('data', fail);
    child.stdout.on('data', chunk => {
      if (settled || failed) return;
      pending += chunk.toString('utf8');
      if (pending.length > 256) return fail();
      while (pending.includes('\n')) {
        const index = pending.indexOf('\n');
        const line = pending.slice(0, index).replace(/\r$/, '');
        pending = pending.slice(index + 1);
        if (line === 'ACL_READY' && !ready && !written) {
          ready = true;
          // No credential bytes enter the child before its open handle's DACL
          // and empty length have been verified. The file was born private.
          child.stdin.end(payload);
        } else if (line === 'ACL_WRITTEN' && ready && !written) written = true;
        else return fail();
      }
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Wait for close before cleanup: a terminated Windows writer may still
      // hold a non-delete-sharing handle until its process has actually exited.
      if (failed || code !== 0 || !ready || !written || pending) reject(new Error('PRIVATE_CONFIG_PERMISSIONS_UNAVAILABLE'));
      else resolve();
    });
  });
}

export async function configure(result, env = process.env, {
  writePrivate = writePrivateFile, selectedMcp, requiredMcp, fileName = 'opencode.playground.json',
} = {}) {
  if (result.health.status !== 'OK' || !result.mapped || !result.baseURL) invalid();
  const userRoot = await plainDirectory(env.LOCALAPPDATA);
  await assertOutsideRepo(userRoot);
  const configDir = path.join(userRoot, 'ai-playground', 'config');
  // A valid MCP config already requires this directory. Never create missing
  // directories, and reject every symlink/junction before creating any file.
  const actualDir = await plainDirectory(configDir);
  const relative = path.relative(userRoot, actualDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) invalid();
  await assertOutsideRepo(actualDir);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(fileName) || fileName.includes('..')) invalid();
  const destination = path.join(actualDir, fileName);
  const mcp = Object.fromEntries(Object.entries(result.mapped.mcp).map(([name, entry]) => [name, {
    ...entry,
    enabled: entry.enabled && (selectedMcp === undefined || selectedMcp.has(name)),
  }]));
  if (requiredMcp !== undefined && [...requiredMcp].some(name => !Object.hasOwn(mcp, name) || !mcp[name].enabled)) invalid();
  const modelId = result.modelId ?? result.health.modelId;
  const defaultModel = preferredModelAlias(modelId);
  const models = { companion: {
    name: 'Companion (local)', modelID: modelId,
    // OpenAI-compatible /models does not report limits. Do not claim
    // Companion limits for a different model the user may load later.
    capabilities: { tools: true },
  } };
  if (defaultModel === LOCAL_COMPANION_FAST_MODEL) models['companion-fast'] = {
    name: 'Companion Fast (same local model)', modelID: modelId,
    body: { chat_template_kwargs: { enable_thinking: false } },
    capabilities: { tools: true },
  };
  const config = {
    $schema: SCHEMA,
    instructions: [path.join(path.dirname(fileURLToPath(import.meta.url)), 'AI-PLAYGROUND-INSTRUCTIONS.md')],
    model: defaultModel,
    providers: {
      'ai-playground': {
        name: 'AI Playground (local)', package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: `${result.baseURL}/v1` },
        models,
      },
    },
    mcp,
  };
  const temporary = path.join(actualDir, `.opencode-${randomUUID()}.tmp`);
  try {
    await writePrivate(temporary, `${JSON.stringify(config, null, 2)}\n`);
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return destination;
}

async function resolveOpenCode(env) {
  if (process.platform !== 'win32') return 'opencode';
  const directories = [...(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean),
    ...(env.APPDATA ? [path.join(env.APPDATA, 'npm')] : [])];
  for (const directory of directories) {
    for (const candidate of [path.join(directory, 'opencode.exe'),
      path.join(directory, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe')]) {
      if (await exists(candidate)) return candidate;
    }
  }
  return 'opencode';
}

async function opencodeVersion(command) {
  try {
    const { stdout } = await exec(command, ['--version'], { windowsHide: true, timeout: 5000 });
    return stdout.trim();
  } catch { return null; }
}

async function launch(command, args, options) {
  return new Promise((resolve, reject) => {
    const { signalTarget, spawnProcess = spawn, platform = process.platform,
      registerChildStop = () => {}, ...spawnOptions } = options;
    const child = spawnProcess(command, args, { ...spawnOptions, stdio: 'inherit', shell: false });
    registerChildStop(signal => {
      // Windows broadcasts Ctrl+C to attached console processes. Calling
      // child.kill('SIGINT') there is a forceful termination, not that event.
      if (platform !== 'win32' || signal === 'SIGTERM') child.kill(signal);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
    });
  });
}

async function openApp(env) {
  if (process.platform !== 'win32') invalid();
  const candidates = [
    env.ProgramFiles && path.join(env.ProgramFiles, 'AI Playground', 'AI Playground.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'AI Playground', 'AI Playground.exe'),
  ].filter(Boolean);
  const executable = (await Promise.all(candidates.map(async file => await exists(file) ? file : null))).find(Boolean);
  if (!executable) invalid();
  // Invoke the installed application without changing its private settings.
  await new Promise((resolve, reject) => {
    const child = spawn(executable, [], { detached: true, stdio: 'ignore', shell: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function parseArgs(argv) {
  const [command = 'health', ...rest] = argv;
  if (!['health', 'configure', 'opencode', 'start', 'open'].includes(command)) invalid();
  let endpoint;
  let args = [];
  let requestedMcp;
  let modelAlias;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--' && command === 'opencode') { args = rest.slice(i + 1); break; }
    if (rest[i] === '--json') continue;
    if (rest[i] === '--endpoint' && rest[i + 1]) { endpoint = loopbackEndpoint(rest[++i]); continue; }
    if (command === 'opencode' && rest[i] === '--thinking') { modelAlias = LOCAL_COMPANION_MODEL; continue; }
    if (command === 'opencode' && rest[i] === '--mcp' && rest[i + 1] && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(rest[i + 1])) {
      (requestedMcp ??= new Set()).add(rest[++i]);
      continue;
    }
    invalid();
  }
  return {
    command, endpoint, args, modelAlias,
    selectedMcp: command === 'opencode' ? new Set([...CODING_MCP_SERVERS, ...(requestedMcp ?? [])]) : undefined,
    requiredMcp: requestedMcp,
  };
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const env = options.env ?? process.env;
  const write = options.write ?? (value => process.stdout.write(value));
  const emit = value => write(`${JSON.stringify(value)}\n`);
  try {
    const { command, endpoint, args, modelAlias, selectedMcp, requiredMcp } = parseArgs(argv);
    if (command === 'start' || command === 'open') {
      await (options.openApp ?? openApp)(env);
      emit({ schemaVersion: 1, status: 'OK' });
      return 0;
    }
    let opencode;
    if (command === 'opencode') {
      opencode = await resolveOpenCode(env);
      const version = await (options.opencodeVersion ?? opencodeVersion)(opencode);
      if (!version || !/^(?:opencode\s+)?v?([2-9]|[1-9]\d+)\./.test(version)) {
        emit({ schemaVersion: 1, status: 'UNAVAILABLE', install: INSTALL });
        return 1;
      }
    }
    const result = await inspectHealth({ env, endpoint, runtime: options.runtime });
    if (command === 'health') { emit(result.health); return 0; }
    if (result.health.status !== 'OK') { emit(result.health); return 1; }
    const fileName = command === 'opencode' ? `opencode.playground.${randomUUID()}.json` : undefined;
    if (command === 'configure') {
      await configure(result, env, { selectedMcp, requiredMcp, fileName, writePrivate: options.writePrivate });
      emit(result.health);
      return 0;
    }
    const signalTarget = options.signalTarget ?? process;
    let interrupted;
    let stopChild;
    const onSignal = signal => { interrupted ??= signal; stopChild?.(signal); };
    const onInterrupt = () => onSignal('SIGINT');
    const onTerminate = () => onSignal('SIGTERM');
    signalTarget.on('SIGINT', onInterrupt);
    signalTarget.on('SIGTERM', onTerminate);
    let generated;
    try {
      generated = await configure(result, env, { selectedMcp, requiredMcp, fileName,
        writePrivate: options.writePrivate });
      if (interrupted) return interrupted === 'SIGINT' ? 130 : 143;
      const selectedModel = modelAlias ?? preferredModelAlias(result.modelId ?? result.health.modelId);
      const localArgs = args.includes('--standalone') ? args : ['--standalone', ...args];
      return await (options.launch ?? launch)(opencode, localArgs, {
        cwd: options.cwd ?? process.cwd(), env: { ...env, OPENCODE_CONFIG: generated,
          OPENCODE_CONFIG_CONTENT: localModelInlineConfig(env.OPENCODE_CONFIG_CONTENT, selectedModel) },
        spawnProcess: options.spawnProcess, platform: options.platform,
        registerChildStop: stop => { stopChild = stop; },
      });
    } finally {
      signalTarget.removeListener('SIGINT', onInterrupt);
      signalTarget.removeListener('SIGTERM', onTerminate);
      if (generated) await unlink(generated).catch(() => {});
    }
  } catch {
    // All failure receipts are constant: native errors can contain config/env/argv.
    emit({ schemaVersion: 1, status: 'UNAVAILABLE' });
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
