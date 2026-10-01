const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const HOST = "127.0.0.1";
const PORT = 11436;
// Browser-origin guard (audit fix for #2828). Any page Nour visits can send a
// no-preflight POST to 127.0.0.1; a present, non-loopback Origin is refused. A
// request with no Origin (OpenWebUI server-side, the worker, curl) is allowed.
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
// Host allowlist (DNS rebinding). A rebinding page is same-origin with the
// gateway, so it sends no cross-origin Origin and can read GET responses; its
// Host header still carries the attacker's name. Every real caller (OpenWebUI
// at 127.0.0.1:8080 running natively, the worker's NOUR_LOCAL_GATEWAY_URL,
// OpenCode/Goose, curl) addresses the gateway by a loopback name.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const MAX_RESEARCH_IN_FLIGHT = 1;
const BACKEND_HOST = "127.0.0.1";
const BACKEND_PORT = 11435;
const MAX_BODY = 20 * 1024 * 1024;
const HOME = process.env.USERPROFILE || process.env.HOME;
const LOG = path.join(HOME, "AI", "logs", "nour-local-gateway.log");
const BACKEND_EXE = "C:\\Users\\nourd\\AppData\\Local\\Microsoft\\WinGet\\Packages\\mostlygeek.llama-swap_Microsoft.Winget.Source_8wekyb3d8bbwe\\llama-swap.exe";
const BACKEND_CONFIG = path.join(HOME, "AI", "config", "llama-swap.yaml");
const BACKEND_PID = path.join(HOME, "AI", "config", "llama-swap.pid");
const BACKEND_LOG = path.join(HOME, "AI", "logs", "llama-swap.log");
const BACKEND_ERR = path.join(HOME, "AI", "logs", "llama-swap.err.log");
const KERNEL_PATH = path.join(HOME, "AI", "config", "NOUR-RUNTIME-KERNEL.md");
const KERNEL_MARKER = "[NOUR_RUNTIME_KERNEL_V1]";
const PYTHON_EXE = path.join(HOME, "AppData", "Local", "Programs", "Python", "Python314", "python.exe");
const WORKER_AGENT = path.join(HOME, "AppData", "Local", "StateNour", "external-worker", "external_worker_agent.py");
const PROTECTED_WORKSPACE = path.join(HOME, "Documents", "Codex", "NATTYNOUR-RUNTIME-WRITES-DO-NOT-CLEAN");
const CHATGPT_PLAN_CREDENTIALS = path.join(
  HOME,
  "AppData",
  "Local",
  "StateNour",
  "chatgpt-plan",
  "credentials.dpapi",
);

const UNIFIED_MODELS = [
  {
    id: "nour-auto",
    name: "NOUR Auto · Cost-Safe Router",
    owned_by: "nour",
    context_length: 20000,
  },
  {
    id: "nour-research",
    name: "NOUR Research · Multi-Stage Web Research",
    owned_by: "nour",
    context_length: 20000,
  },
  {
    id: "nour-chatgpt-plan",
    name: "ChatGPT · Plan OAuth",
    owned_by: "nour",
    context_length: 20000,
  },
  {
    id: "nour-codex-chatgpt",
    name: "Codex · ChatGPT Subscription",
    owned_by: "nour",
    context_length: 20000,
  },
  {
    id: "nour-claude-subscription",
    name: "Claude · Subscription",
    owned_by: "nour",
    context_length: 20000,
  },
  {
    id: "nour-antigravity",
    name: "Antigravity · Google Account",
    owned_by: "nour",
    context_length: 20000,
  },
];
const UNIFIED_MODEL_IDS = new Set(UNIFIED_MODELS.map(model => model.id));

let kernelCache = { mtimeMs: -1, text: "" };
let queueTail = Promise.resolve();
let queueDepth = 0;
let backendStartPromise = null;
let researchInFlight = 0;

function log(message) {
  const line = new Date().toISOString() + " " + message + "\n";
  try { fs.appendFileSync(LOG, line); } catch {}
  process.stdout.write(line);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadKernel() {
  try {
    const stat = fs.statSync(KERNEL_PATH);
    if (kernelCache.mtimeMs !== stat.mtimeMs) {
      const raw = fs.readFileSync(KERNEL_PATH, "utf8").replace(/^\uFEFF/, "").trim();
      kernelCache = {
        mtimeMs: stat.mtimeMs,
        text: raw ? KERNEL_MARKER + "\n" + raw : "",
      };
      log("intelligence kernel loaded bytes=" + Buffer.byteLength(kernelCache.text, "utf8"));
    }
    return kernelCache.text;
  } catch (err) {
    if (kernelCache.text) log("intelligence kernel unavailable; retaining last known copy: " + String(err.message || err));
    else log("intelligence kernel unavailable: " + String(err.message || err));
    return kernelCache.text;
  }
}

function injectIntelligence(targetPath, body) {
  if (!body) return body;
  const kernel = loadKernel();
  if (!kernel) return body;

  try {
    const payload = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body));

    if (/^\/v1\/chat\/completions(?:\?|$)/.test(targetPath) && Array.isArray(payload.messages)) {
      const existing = payload.messages.find(
        m => m && m.role === "system" && typeof m.content === "string"
      );
      if (existing) {
        if (!existing.content.includes(KERNEL_MARKER)) {
          existing.content = kernel + "\n\n--- Client/system instructions ---\n" + existing.content;
        }
      } else {
        payload.messages.unshift({ role: "system", content: kernel });
      }
      return Buffer.from(JSON.stringify(payload), "utf8");
    }

    if (/^\/v1\/responses(?:\?|$)/.test(targetPath)) {
      const existing = typeof payload.instructions === "string" ? payload.instructions : "";
      if (!existing.includes(KERNEL_MARKER)) {
        payload.instructions = existing
          ? kernel + "\n\n--- Client/system instructions ---\n" + existing
          : kernel;
      }
      return Buffer.from(JSON.stringify(payload), "utf8");
    }

    return body;
  } catch (err) {
    log("intelligence injection skipped path=" + targetPath + " error=" + String(err.message || err));
    return body;
  }
}

function backendRequest(method, targetPath, headers = {}, body = null, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    delete h.host;
    delete h.connection;
    if (body) h["content-length"] = Buffer.byteLength(body);
    const req = http.request({
      hostname: BACKEND_HOST,
      port: BACKEND_PORT,
      path: targetPath,
      method,
      headers: h,
      timeout: timeoutMs,
    }, res => resolve(res));
    req.on("timeout", () => req.destroy(new Error("backend timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
async function drain(res) {
  return await new Promise(resolve => {
    const chunks = [];
    res.on("data", c => chunks.push(c));
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", () => resolve(""));
  });
}
async function backendReady() {
  try {
    const res = await backendRequest("GET", "/v1/models");
    const ok = res.statusCode === 200;
    await drain(res);
    return ok;
  } catch {
    return false;
  }
}

async function unloadLocalQwenForHeavyPrompt(prompt, routingPrompt) {
  const promptChars = String(prompt || "").length;
  const routingChars = String(routingPrompt || "").length;
  if (promptChars <= 24000 && routingChars <= 20000) return false;

  try {
    const res = await backendRequest(
      "POST",
      "/api/models/unload/qwen35-4b-local",
      {},
      null,
      15000
    );
    const body = (await drain(res)).trim();
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    log(
      `heavy prompt local unload status=${res.statusCode} ok=${ok} ` +
      `promptChars=${promptChars} routingChars=${routingChars} body=${body.slice(0, 120)}`
    );
    return ok;
  } catch (err) {
    log(
      `heavy prompt local unload skipped promptChars=${promptChars} ` +
      `routingChars=${routingChars} error=${String(err && err.message ? err.message : err)}`
    );
    return false;
  }
}

async function ensureBackend() {
  if (await backendReady()) return true;
  if (!backendStartPromise) {
    backendStartPromise = (async () => {
      log("backend unavailable; starting llama-swap directly");
      if (!fs.existsSync(BACKEND_EXE)) {
        log("backend executable missing: " + BACKEND_EXE);
        return false;
      }
      const outFd = fs.openSync(BACKEND_LOG, "a");
      const errFd = fs.openSync(BACKEND_ERR, "a");
      const p = spawn(BACKEND_EXE, [
        "-config", BACKEND_CONFIG,
        "-listen", "127.0.0.1:11435",
        "-watch-config"
      ], { windowsHide: true, detached: true, stdio: ["ignore", outFd, errFd] });
      try { fs.writeFileSync(BACKEND_PID, String(p.pid), "ascii"); } catch {}
      try { fs.closeSync(outFd); fs.closeSync(errFd); } catch {}
      p.unref();
      for (let i = 0; i < 90; i++) {
        if (await backendReady()) {
          log("backend recovered pid=" + p.pid);
          return true;
        }
        await sleep(1000);
      }
      log("backend failed to recover within 90s");
      return false;
    })().finally(() => { backendStartPromise = null; });
  }
  return await backendStartPromise;
}
function isInference(method, targetPath) {
  if (method !== "POST") return false;
  return /^\/v1\/(chat\/completions|completions|responses|embeddings)(\?|$)/.test(targetPath);
}
function requiresKernel(targetPath) {
  return /^\/v1\/(chat\/completions|responses)(\?|$)/.test(targetPath);
}
function enqueue(task) {
  queueDepth++;
  const run = queueTail.then(task, task);
  queueTail = run.catch(() => {}).finally(() => { queueDepth--; });
  return run;
}
function hostAllowed(host) {
  if (host === undefined) return false;
  return LOOPBACK_HOST.test(String(host));
}
function originAllowed(origin) {
  if (origin === undefined) return true;
  return LOOPBACK_ORIGIN.test(String(origin));
}
function isJsonContentType(contentType) {
  return String(contentType || "").split(";")[0].trim().toLowerCase() === "application/json";
}
function sendJsonError(res, status, message, type) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message, type } }));
}
function copyHeaders(src, dest) {
  for (const [k, v] of Object.entries(src)) {
    if (v !== undefined && !["connection", "keep-alive", "transfer-encoding"].includes(k.toLowerCase())) {
      try { dest.setHeader(k, v); } catch {}
    }
  }
}

function unifiedModelRecord(model, status = "available") {
  const created = Math.floor(Date.now() / 1000);
  return {
    id: model.id,
    name: model.name,
    object: "model",
    created,
    owned_by: model.owned_by,
    context_length: model.context_length,
    context_window: model.context_length,
    capabilities: { function_calling: true },
    supported_parameters: ["tools", "tool_choice"],
    status: { value: status },
    meta: {
      nour: {
        unified: true,
        interactiveReadOnly: true,
        costSafe: true,
      },
    },
  };
}

async function mergedModels() {
  let physical = [];
  try {
    await ensureBackend();
    const upstream = await backendRequest("GET", "/v1/models");
    const raw = await drain(upstream);
    if (upstream.statusCode === 200) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed && parsed.data)) physical = parsed.data;
    }
  } catch (err) {
    log("model list backend probe failed: " + String(err && err.message ? err.message : err));
  }
  const logical = UNIFIED_MODELS
    .filter(model => model.id !== "nour-chatgpt-plan" || fs.existsSync(CHATGPT_PLAN_CREDENTIALS))
    .map(model => unifiedModelRecord(model));
  const [autoModel, ...externalModels] = logical;
  const localModels = [];
  const otherPhysical = [];
  for (const model of physical) {
    if (String(model && model.id || "") === "qwen35-4b-local") {
      localModels.push({
        ...model,
        name: "Local Qwen · $0 Incremental",
        meta: {
          ...(model.meta || {}),
          nour: {
            ...((model.meta && model.meta.nour) || {}),
            unified: true,
            physicalLocal: true,
            costSafe: true,
          },
        },
      });
    } else {
      otherPhysical.push(model);
    }
  }
  return {
    object: "list",
    data: [
      ...(autoModel ? [autoModel] : []),
      ...localModels,
      ...externalModels,
      ...otherPhysical,
    ],
  };
}

function messageContentText(content) {
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (!part || typeof part !== "object") return "";
        if (typeof part.text === "string") return part.text;
        if (typeof part.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

function messagesToPrompt(messages) {
  if (!Array.isArray(messages)) return "";
  return messages
    .filter(message => message && typeof message === "object")
    .map(message => {
      const role = String(message.role || "user").toUpperCase();
      const content = messageContentText(message.content);
      const extras = [];
      if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
        const calls = message.tool_calls.map(call => ({
          id: String(call && call.id || ""),
          name: String(call && call.function && call.function.name || ""),
          arguments: String(call && call.function && call.function.arguments || "{}"),
        }));
        extras.push("TOOL_CALLS:\n" + JSON.stringify(calls));
      }
      if (String(message.role || "").toLowerCase() === "tool") {
        extras.push(
          "TOOL_RESULT_META:\n" +
          JSON.stringify({
            tool_call_id: String(message.tool_call_id || ""),
            name: String(message.name || ""),
          })
        );
      }
      return role + ":\n" + [content, ...extras].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function compactToolSchema(schema, depth = 0) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || depth > 6) return {};
  const out = {};
  if (typeof schema.type === "string") out.type = schema.type;
  if (Array.isArray(schema.enum) && schema.enum.length <= 32) out.enum = schema.enum;
  if (Array.isArray(schema.required) && schema.required.length) out.required = schema.required.map(String);
  if (schema.items && typeof schema.items === "object") {
    out.items = compactToolSchema(schema.items, depth + 1);
  }
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      out.properties[key] = compactToolSchema(value, depth + 1);
    }
  }
  for (const unionKey of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schema[unionKey])) {
      out[unionKey] = schema[unionKey].slice(0, 12).map(item => compactToolSchema(item, depth + 1));
    }
  }
  if (typeof schema.additionalProperties === "boolean") {
    out.additionalProperties = schema.additionalProperties;
  } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    out.additionalProperties = compactToolSchema(schema.additionalProperties, depth + 1);
  }
  return out;
}

function normalizeToolDefinitions(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .filter(tool => tool && tool.type === "function" && tool.function && tool.function.name)
    .map(tool => ({
      name: String(tool.function.name),
      description: String(tool.function.description || "").replace(/\s+/g, " ").trim().slice(0, 180),
      parameters: compactToolSchema(
        tool.function.parameters && typeof tool.function.parameters === "object"
          ? tool.function.parameters
          : { type: "object", properties: {} }
      ),
    }));
}

function buildToolAwarePrompt(messages, tools, toolChoice) {
  const normalizedTools = normalizeToolDefinitions(tools);
  const conversation = messagesToPrompt(messages);
  if (!normalizedTools.length || toolChoice === "none") return conversation;
  const choice = typeof toolChoice === "string"
    ? toolChoice
    : (toolChoice && toolChoice.function && toolChoice.function.name
      ? { function: String(toolChoice.function.name) }
      : "auto");
  return [
    "__NOUR_TOOL_PROTOCOL__",
    "You are the reasoning model inside an OpenAI-compatible tool loop.",
    "You do NOT execute tools yourself. Decide whether the client must execute one or more tools.",
    "Return ONLY one JSON object and no markdown.",
    "If tools are needed, use:",
    '{"type":"tool_calls","tool_calls":[{"id":"call_1","name":"TOOL_NAME","arguments":{}}]}',
    "If no tool is needed, use:",
    '{"type":"final","content":"FINAL_ANSWER"}',
    "Tool arguments MUST be valid JSON objects matching the supplied schema.",
    "Use tool results already present in the conversation before deciding on another tool.",
    "Tool choice policy: " + JSON.stringify(choice),
    "AVAILABLE_TOOLS:",
    JSON.stringify(normalizedTools),
    "CONVERSATION:",
    conversation,
  ].join("\n\n");
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const unfenced = raw
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();
  try { return JSON.parse(unfenced); } catch {}
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(unfenced.slice(first, last + 1)); } catch {}
  }
  return null;
}

function parseToolDecision(output, tools, toolChoice) {
  const normalizedTools = normalizeToolDefinitions(tools);
  const allowed = new Set(normalizedTools.map(tool => tool.name));
  if (!normalizedTools.length || toolChoice === "none") {
    return { content: String(output || ""), tool_calls: [], finish_reason: "stop" };
  }
  const parsed = extractJsonObject(output);
  const rawCalls = parsed && Array.isArray(parsed.tool_calls)
    ? parsed.tool_calls
    : (parsed && parsed.tool_call ? [parsed.tool_call] : []);
  const toolCalls = [];
  for (let i = 0; i < rawCalls.length; i++) {
    const call = rawCalls[i] || {};
    const name = String(call.name || call.function && call.function.name || "");
    if (!allowed.has(name)) continue;
    let args = call.arguments ?? (call.function && call.function.arguments) ?? {};
    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
    toolCalls.push({
      id: String(call.id || "call_nour_" + Date.now().toString(36) + "_" + i),
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    });
  }
  if (toolCalls.length) {
    return { content: null, tool_calls: toolCalls, finish_reason: "tool_calls" };
  }
  if (parsed && parsed.type === "final" && typeof parsed.content === "string") {
    return { content: parsed.content, tool_calls: [], finish_reason: "stop" };
  }
  return { content: String(output || ""), tool_calls: [], finish_reason: "stop" };
}

function userRoutingContext(messages) {
  if (!Array.isArray(messages)) return { latest: "", prior: "" };
  const turns = messages
    .filter(
      message =>
        message &&
        typeof message === "object" &&
        String(message.role || "").toLowerCase() === "user"
    )
    .map(message => messageContentText(message.content).trim())
    .filter(Boolean);
  return {
    latest: turns.at(-1) || "",
    prior: (turns.at(-2) || "").slice(-80000),
  };
}

function scrubbedInteractiveEnv() {
  const env = { ...process.env };
  for (const key of [
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "RUNNER_SHARED_SECRET",
  ]) delete env[key];
  env.NOUR_EXTERNAL_WORKER_ALLOW_WRITES = "0";
  env.NOUR_EXTERNAL_WORKER_WORKSPACES_JSON = JSON.stringify({
    repo: PROTECTED_WORKSPACE,
    statenour: path.join(PROTECTED_WORKSPACE, "apps", "statenour"),
    nickstire: path.join(PROTECTED_WORKSPACE, "apps", "nickstire"),
  });
  env.NOUR_LOCAL_GATEWAY_URL = "http://127.0.0.1:11436";
  return env;
}

// The worker reports a refusal as { status: "failed", errorCode, errorMessage }.
// Carrying errorCode onto the Error is what lets serveUnifiedChat answer a busy
// research slot (RESEARCH_BUSY) with 429 instead of a generic 503.
function workerFailure(parsed, stderrText) {
  const workerOutput = String(parsed && parsed.result && parsed.result.output || "").trim();
  const detail = workerOutput ? `; workerOutput=${workerOutput.slice(0, 2000)}` : "";
  const message = String(parsed.errorMessage || parsed.errorCode || stderrText || "interactive adapter failed") + detail;
  const failure = new Error(message);
  if (parsed.errorCode) failure.code = String(parsed.errorCode);
  return failure;
}

function runWorkerAdapter(request, mode = "--local-chat", expectedStatus = "completed", timeoutMs = 480000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(PYTHON_EXE)) return reject(new Error("Python runtime missing"));
    if (!fs.existsSync(WORKER_AGENT)) return reject(new Error("external worker adapter missing"));
    const child = spawn(PYTHON_EXE, [WORKER_AGENT, mode], {
      windowsHide: true,
      cwd: PROTECTED_WORKSPACE,
      env: scrubbedInteractiveEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const cap = 4 * 1024 * 1024;
    const timer = setTimeout(() => {
      try {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => {
          try { child.kill(); } catch {}
        });
      } catch {
        try { child.kill(); } catch {}
      }
      reject(new Error(mode + " adapter timed out"));
    }, timeoutMs);
    child.stdout.on("data", chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= cap) stdout.push(chunk);
    });
    child.stderr.on("data", chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes <= cap) stderr.push(chunk);
    });
    child.on("error", err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", code => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf8").trim();
      const err = Buffer.concat(stderr).toString("utf8").trim();
      try {
        const parsed = JSON.parse(out);
        if (parsed.status !== expectedStatus) return reject(workerFailure(parsed, err));
        resolve(parsed);
      } catch (parseErr) {
        reject(new Error(err || out || String(parseErr && parseErr.message ? parseErr.message : parseErr)));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function runInteractiveAdapter(request) {
  return runWorkerAdapter(request);
}

function runLaneProbe() {
  return runWorkerAdapter(undefined, "--local-probe", "ok", 45000);
}

function writeOpenAiCompletion(res, requestedModel, decision, stream, lane = "unknown") {
  const id = "chatcmpl-nour-" + Date.now().toString(36);
  const created = Math.floor(Date.now() / 1000);
  const content = decision && Object.prototype.hasOwnProperty.call(decision, "content")
    ? decision.content
    : String(decision || "");
  const toolCalls = Array.isArray(decision && decision.tool_calls) ? decision.tool_calls : [];
  const finishReason = String(decision && decision.finish_reason || (toolCalls.length ? "tool_calls" : "stop"));
  if (stream) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-nour-lane": lane,
      connection: "keep-alive",
    });
    res.write("data: " + JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model: requestedModel,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    }) + "\n\n");
    if (toolCalls.length) {
      res.write("data: " + JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model: requestedModel,
        choices: [{
          index: 0,
          delta: {
            tool_calls: toolCalls.map((call, index) => ({
              index,
              id: call.id,
              type: "function",
              function: {
                name: call.function.name,
                arguments: call.function.arguments,
              },
            })),
          },
          finish_reason: null,
        }],
      }) + "\n\n");
    } else if (content !== null && content !== undefined && String(content).length) {
      res.write("data: " + JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model: requestedModel,
        choices: [{ index: 0, delta: { content: String(content) }, finish_reason: null }],
      }) + "\n\n");
    }
    res.write("data: " + JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model: requestedModel,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    }) + "\n\n");
    res.end("data: [DONE]\n\n");
    return;
  }
  const message = { role: "assistant", content: content === undefined ? "" : content };
  if (toolCalls.length) message.tool_calls = toolCalls;
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "x-nour-lane": lane });
  res.end(JSON.stringify({
    id,
    object: "chat.completion",
    created,
    model: requestedModel,
    choices: [{
      index: 0,
      message,
      finish_reason: finishReason,
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }));
}

async function serveUnifiedChat(req, res, body) {
  const started = Date.now();
  let payload;
  let routingPrompt = "";
  let priorUserPrompt = "";
  try {
    const original = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body || "{}"));
    const routing = userRoutingContext(original.messages);
    routingPrompt = routing.latest;
    priorUserPrompt = routing.prior;
    const prepared = injectIntelligence(req.url, body);
    payload = JSON.parse(Buffer.isBuffer(prepared) ? prepared.toString("utf8") : String(prepared || "{}"));
  } catch (err) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Invalid chat request", type: "invalid_request_error" } }));
    return;
  }
  const requestedModel = String(payload.model || "");
  const toolDefinitions = normalizeToolDefinitions(payload.tools);
  const prompt = buildToolAwarePrompt(payload.messages, toolDefinitions.length ? payload.tools : [], payload.tool_choice);
  if (!prompt.trim()) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "No chat messages supplied", type: "invalid_request_error" } }));
    return;
  }
  log(`unified start model=${requestedModel} promptChars=${prompt.length} routingChars=${routingPrompt.length} priorRoutingChars=${priorUserPrompt.length}`);
  try {
    await unloadLocalQwenForHeavyPrompt(prompt, routingPrompt);
    const result = await gatewayDeps.runInteractiveAdapter({
      model: requestedModel,
      prompt,
      routingPrompt,
      priorUserPrompt,
      workspaceKey: "repo",
    });
    const output = String(result && result.result && result.result.output || "");
    const lane = String(result && result.result && result.result.laneId || "unknown");
    const candidates = Array.isArray(result && result.candidateLaneIds)
      ? result.candidateLaneIds.join(",")
      : "unknown";
    const attemptTimeout = Number(result && result.result && result.result.attemptTimeoutSeconds || 0);
    const attemptFailures = Array.isArray(result && result.result && result.result.attemptFailures)
      ? result.result.attemptFailures.join(",")
      : "";
    const decision = parseToolDecision(output, payload.tools, payload.tool_choice);
    log(
      `unified served model=${requestedModel} lane=${lane} candidates=${candidates} ` +
      `attemptTimeout=${attemptTimeout}s failures=${attemptFailures || "none"} ` +
      `toolCalls=${decision.tool_calls.length} promptChars=${prompt.length} ms=${Date.now()-started}`
    );
    writeOpenAiCompletion(res, requestedModel, decision, Boolean(payload.stream), lane);
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    if (err && err.code === "RESEARCH_BUSY") {
      // The worker holds one OS-level research slot for both "nour-research"
      // and a "nour-auto" it promoted to research, so this covers both.
      log(`blocked model=${requestedModel} reason=research-busy source=worker ms=${Date.now()-started}`);
      return sendJsonError(res, 429, "A research run is already in progress; retry when it finishes.", "nour_research_busy");
    }
    log(`unified failed model=${requestedModel} error=${message} ms=${Date.now()-started}`);
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({
      error: {
        message,
        type: "nour_unified_lane_unavailable",
      },
    }));
  }
}
async function proxyWithRetry(req, res, body) {
  const retryable = new Set([429, 502, 503, 504]);
  const started = Date.now();
  if (requiresKernel(req.url) && !loadKernel()) {
    log(`blocked path=${req.url} reason=intelligence-kernel-missing`);
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Nour intelligence kernel unavailable; refusing ungoverned chat inference.", type: "nour_kernel_unavailable" } }));
    return;
  }
  const preparedBody = injectIntelligence(req.url, body);
  let last = "unknown";
  for (let attempt = 1; attempt <= 30; attempt++) {
    if (!(await ensureBackend())) last = "backend unavailable";
    try {
      const upstream = await backendRequest(req.method, req.url, req.headers, preparedBody);
      if (retryable.has(upstream.statusCode)) {
        last = "HTTP " + upstream.statusCode + " " + await drain(upstream);
        const delay = Math.min(8000, 500 * Math.pow(1.55, attempt));
        log(`retry ${attempt} path=${req.url} reason=${upstream.statusCode} waitMs=${Math.round(delay)}`);
        await sleep(delay);
        continue;
      }
      res.statusCode = upstream.statusCode;
      copyHeaders(upstream.headers, res);
      const upstreamDone = new Promise(resolve => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        upstream.once("end", finish);
        upstream.once("close", finish);
        upstream.once("aborted", finish);
        upstream.once("error", finish);
        res.once("finish", finish);
        res.once("close", finish);
        res.once("error", finish);
      });
      upstream.pipe(res);
      await upstreamDone;
      log(`served path=${req.url} status=${upstream.statusCode} attempts=${attempt} queue=${queueDepth} ms=${Date.now()-started}`);
      return;
    } catch (err) {
      last = String(err && err.message ? err.message : err);
      log(`retry ${attempt} path=${req.url} error=${last}`);
      await sleep(Math.min(8000, 500 * Math.pow(1.55, attempt)));
    }
  }
  if (!res.headersSent) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Local AI temporarily unavailable after automatic recovery attempts.", type: "nour_gateway_unavailable", detail: last } }));
  }
}
async function proxyDirect(req, res, body) {
  if (!(await ensureBackend())) {
    res.writeHead(503, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "backend unavailable" }));
  }
  try {
    const upstream = await backendRequest(req.method, req.url, req.headers, body);
    res.statusCode = upstream.statusCode;
    copyHeaders(upstream.headers, res);
    upstream.pipe(res);
  } catch (err) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
}
const gatewayDeps = { runInteractiveAdapter, runLaneProbe };
const server = http.createServer((req, res) => {
  if (!hostAllowed(req.headers.host)) {
    log(`blocked path=${req.url} reason=host host=${String(req.headers.host || "").slice(0, 120)}`);
    return sendJsonError(res, 403, "Host is not a loopback name for this gateway.", "nour_host_forbidden");
  }
  if (!originAllowed(req.headers.origin)) {
    log(`blocked path=${req.url} reason=cross-origin origin=${String(req.headers.origin).slice(0, 120)}`);
    return sendJsonError(res, 403, "Cross-origin requests are not allowed.", "nour_origin_forbidden");
  }
  if (req.method === "POST" && /^\/v1\//.test(req.url) && !isJsonContentType(req.headers["content-type"])) {
    log(`blocked path=${req.url} reason=content-type value=${String(req.headers["content-type"] || "").slice(0, 80)}`);
    return sendJsonError(res, 415, "POST /v1/* requires content-type application/json.", "nour_unsupported_media_type");
  }

  if (req.method === "GET" && /^\/v1\/models(?:\?|$)/.test(req.url)) {
    mergedModels()
      .then(models => {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(models));
      })
      .catch(err => {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      });
    return;
  }

  if (req.method === "GET" && /^\/health\/lanes(?:\?|$)/.test(req.url)) {
    gatewayDeps.runLaneProbe()
      .then(probe => {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(probe));
      })
      .catch(err => {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({
          status: "degraded",
          error: String(err && err.message ? err.message : err),
        }));
      });
    return;
  }

  if (req.url === "/health") {
    ensureBackend().then(ok => {
      const kernel = loadKernel();
      const healthy = ok && Boolean(kernel);
      res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({
        status: healthy ? "ok" : "degraded",
        backendReady: ok,
        queueDepth,
        intelligenceKernel: { active: Boolean(kernel), bytes: Buffer.byteLength(kernel || "", "utf8") },
        backend: "http://127.0.0.1:11435",
        gateway: "http://127.0.0.1:11436"
      }));
    });
    return;
  }

  const chunks = [];
  let size = 0;
  req.on("data", chunk => {
    size += chunk.length;
    if (size > MAX_BODY) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "request body too large" }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    const body = chunks.length ? Buffer.concat(chunks) : null;

    if (req.method === "POST" && /^\/v1\/chat\/completions(?:\?|$)/.test(req.url) && body) {
      try {
        const parsed = JSON.parse(body.toString("utf8"));
        if (UNIFIED_MODEL_IDS.has(String(parsed.model || ""))) {
          if (!loadKernel()) {
            res.writeHead(503, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Nour intelligence kernel unavailable; refusing ungoverned chat inference.", type: "nour_kernel_unavailable" } }));
            return;
          }
          const isResearch = String(parsed.model) === "nour-research";
          if (isResearch && researchInFlight >= MAX_RESEARCH_IN_FLIGHT) {
            log("blocked model=nour-research reason=research-busy");
            return sendJsonError(res, 429, "A nour-research run is already in progress; retry when it finishes.", "nour_research_busy");
          }
          if (isResearch) researchInFlight++;
          serveUnifiedChat(req, res, body).catch(err => {
            if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
            if (!res.writableEnded) res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
          }).finally(() => {
            if (isResearch) researchInFlight--;
          });
          return;
        }
      } catch {}
    }

    const task = () => proxyWithRetry(req, res, body);
    if (isInference(req.method, req.url)) {
      log(`queued path=${req.url} depth=${queueDepth + 1}`);
      enqueue(task).catch(err => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        if (!res.writableEnded) res.end(JSON.stringify({ error: String(err.message || err) }));
      });
    } else {
      proxyDirect(req, res, body);
    }
  });
});

server.on("clientError", (err, socket) => {
  log("clientError " + String(err.message || err));
  try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); } catch {}
});

// The launcher lives on Nour's machine (not in this repo) and may wrap the script
// (pm2 fork mode requires it), so listening stays the default; only the test
// harness opts out with NOUR_GATEWAY_NO_LISTEN=1.
if (process.env.NOUR_GATEWAY_NO_LISTEN !== "1") {
  server.listen(PORT, HOST, () => {
    log(`Nour AI Gateway listening on http://${HOST}:${PORT}`);
  });
}

function gatewayState() {
  return { researchInFlight };
}

module.exports = {
  server,
  gatewayDeps,
  gatewayState,
  hostAllowed,
  originAllowed,
  isJsonContentType,
  scrubbedInteractiveEnv,
  workerFailure,
};
