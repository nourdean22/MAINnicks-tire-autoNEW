// options.js · token + base URL setup · 2026-05-23.

// 2026-05-23 · default to bdnick.info · operator-facing custom domain.
// Railway URL still works · operator can override via this options
// page if they want preview / localhost.
const DEFAULT_API_BASE = "https://bdnick.info";
const $ = (id) => document.getElementById(id);

function setStatus(msg, kind = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = `status ${kind}`;
}

async function load() {
  chrome.storage.local.get(["apiBase", "token"], (out) => {
    $("apiBase").value = out.apiBase ?? DEFAULT_API_BASE;
    $("token").value = out.token ?? "";
    // Wire the "Get one from /system/api-tokens" link to the
    // current apiBase value so it follows whatever the operator
    // sets (e.g. localhost for dev).
    $("open-tokens-link").href = `${out.apiBase ?? DEFAULT_API_BASE}/system/api-tokens`;
  });
}

async function save() {
  const apiBase = $("apiBase").value.trim() || DEFAULT_API_BASE;
  const token = $("token").value.trim();
  chrome.storage.local.set({ apiBase, token }, () => {
    setStatus("saved", "ok");
    setTimeout(() => setStatus(""), 1200);
  });
}

$("save").addEventListener("click", save);
$("apiBase").addEventListener("input", () => {
  $("open-tokens-link").href = `${$("apiBase").value.trim() || DEFAULT_API_BASE}/system/api-tokens`;
});
load();
