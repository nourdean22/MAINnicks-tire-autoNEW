// background.js · MV3 service worker · 2026-05-23.
//
// The popup is currently the entire interaction surface · the
// service worker just lives here to satisfy MV3 + handle future
// context-menu / commands wiring (F2 right-click "Ask Nick" etc).

chrome.runtime.onInstalled.addListener(() => {
  console.log("[statenour] extension installed · v0.1.0");
});
