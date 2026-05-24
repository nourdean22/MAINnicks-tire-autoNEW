// popup.js · Chrome extension brain-dump UI · MV3 · 2026-05-23.
//
// Flow:
//   1. On open, read { apiBase, token } from chrome.storage.local
//   2. Read current tab title + URL (activeTab permission)
//   3. Operator types → Cmd+Enter (or Save) → POST /api/brain/dump
//   4. Show success/error status · close popup after 600ms on success

const $ = (id) => document.getElementById(id);

async function getActiveTabContext() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const t = tabs[0];
    return {
      sourceUrl: t?.url ?? null,
      sourceTitle: t?.title ?? null,
    };
  } catch {
    return { sourceUrl: null, sourceTitle: null };
  }
}

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["apiBase", "token"], (out) => {
      resolve({
        apiBase: out.apiBase ?? "https://statenour-web-production.up.railway.app",
        token: out.token ?? null,
      });
    });
  });
}

function setStatus(msg, kind = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = `status ${kind}`;
}

function renderSetupCallout() {
  const ta = $("content");
  const wrapper = document.createElement("div");
  wrapper.className = "setup";
  wrapper.innerHTML = `
    <strong>Setup needed.</strong> Open the
    <a href="#" id="open-options">extension options</a>
    and paste a token from
    <a href="https://statenour-web-production.up.railway.app/system/api-tokens" target="_blank" rel="noopener">/system/api-tokens</a>.
  `;
  ta.replaceWith(wrapper);
  $("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  $("save").disabled = true;
}

async function save() {
  const content = $("content").value.trim();
  if (!content) {
    setStatus("nothing to save", "err");
    return;
  }
  const { apiBase, token } = await getConfig();
  if (!token) {
    setStatus("no token configured", "err");
    return;
  }
  const ctx = await getActiveTabContext();
  $("save").disabled = true;
  setStatus("saving…");

  try {
    const res = await fetch(`${apiBase}/api/brain/dump`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        content,
        sourceUrl: ctx.sourceUrl ?? undefined,
        sourceTitle: ctx.sourceTitle ?? undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      setStatus(`failed · ${res.status} ${body.slice(0, 80)}`, "err");
      $("save").disabled = false;
      return;
    }
    const data = await res.json();
    setStatus(`saved · ${data.key ?? "ok"}`, "ok");
    setTimeout(() => window.close(), 600);
  } catch (err) {
    setStatus(`network · ${err?.message ?? "unknown"}`, "err");
    $("save").disabled = false;
  }
}

// 2026-05-23 · Wave J · F3 · query prior notes for this URL and
// render them above the composer. Fire-and-forget · network failure
// just hides the panel · doesn't block the compose flow.
async function loadPriorNotes(apiBase, token, url) {
  if (!url) return;
  try {
    const u = new URL(`${apiBase}/api/brain/by-url`);
    u.searchParams.set("url", url);
    u.searchParams.set("limit", "3");
    const res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data.notes) || data.notes.length === 0) return;
    const panel = $("prior-notes");
    const list = data.notes
      .map((n) => {
        const when = new Date(n.capturedAt).toLocaleDateString();
        const snippet = escapeHtml(n.content.slice(0, 140));
        return `<div class="prior-note"><div class="meta">${escapeHtml(n.category)} · ${when}</div>${snippet}</div>`;
      })
      .join("");
    panel.innerHTML = `
      <div class="prior-notes-header">
        <span>● ${data.notes.length} prior note${data.notes.length === 1 ? "" : "s"} on this ${data.domain ? "domain" : "URL"}</span>
      </div>
      <div class="prior-notes-list">${list}</div>
    `;
    panel.hidden = false;
  } catch {
    // silent · nothing to show
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function init() {
  const ctx = await getActiveTabContext();
  const hint = $("ctx-hint");
  if (ctx.sourceTitle) {
    hint.textContent = ctx.sourceTitle;
    hint.title = ctx.sourceUrl ?? "";
  }

  const { apiBase, token } = await getConfig();
  if (!token) {
    renderSetupCallout();
    return;
  }

  $("save").addEventListener("click", save);
  $("cancel").addEventListener("click", () => window.close());

  $("content").addEventListener("keydown", (e) => {
    // Cmd+Enter (mac) / Ctrl+Enter (win) → save
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      save();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      window.close();
    }
  });

  // Wave J · query prior notes in parallel · don't block input.
  void loadPriorNotes(apiBase, token, ctx.sourceUrl);
}

init();
