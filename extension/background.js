"use strict";

/**
 * Firefox MCP — background script
 *
 * Wire protocol (must match src/protocol.ts in the MCP server):
 *
 *   MCP server → extension:
 *     { id, type, payload }
 *
 *   extension → MCP server (response):
 *     { id, type: "messageResponse", payload: { requestId, result?, error? } }
 *
 * The extension is the WebSocket **client**; the MCP server is the **server**.
 * One tab at a time — a new connection replaces the previous one.
 */

const WS_URL = "ws://127.0.0.1:9009";
const RECONNECT_DELAY_MS = 2_000;
const NAV_TIMEOUT_MS = 30_000;
const MESSAGE_RESPONSE_TYPE = "messageResponse";

/** @type {WebSocket|null} */
let socket = null;
/** @type {number|null} */
let connectedTabId = null;
let wantConnection = false;
let reconnectTimer = null;
let wsOpen = false;

// ─── badge ────────────────────────────────────────────────────────────────────

function setBadge(tabId, text, color) {
  if (tabId == null) return;
  try {
    browser.browserAction.setBadgeText({ tabId, text });
    if (color != null)
      browser.browserAction.setBadgeBackgroundColor({ tabId, color });
  } catch { /* tab may have closed */ }
}

function refreshBadge() {
  if (connectedTabId == null) return;
  if (wsOpen) {
    setBadge(connectedTabId, "ON", "#2e7d32");
  } else if (wantConnection) {
    setBadge(connectedTabId, "…", "#f57c00");
  } else {
    setBadge(connectedTabId, "", null);
  }
}

// ─── tab helpers ──────────────────────────────────────────────────────────────

function requireTab() {
  if (connectedTabId == null)
    throw new Error("No tab is connected. Click the Firefox MCP toolbar icon in the tab you want to control.");
  return connectedTabId;
}

async function ensureContentScript(tabId) {
  try {
    await browser.tabs.executeScript(tabId, { file: "/content.js" });
  } catch { /* restricted page or already injected */ }
}

async function sendToContent(method, params) {
  const tabId = requireTab();
  try {
    return await browser.tabs.sendMessage(tabId, { method, params });
  } catch {
    try {
      await ensureContentScript(tabId);
      return await browser.tabs.sendMessage(tabId, { method, params });
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (/Could not establish connection/i.test(msg)) {
        throw new Error(
          "Cannot reach the content script on this page. " +
          "This happens on privileged pages (about:*, addons.mozilla.org). " +
          "Connect to a normal https:// page instead.",
        );
      }
      throw err;
    }
  }
}

// ─── navigation helpers ───────────────────────────────────────────────────────

function withScheme(url) {
  const s = String(url).trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d+\.\d+\.\d+\.\d+/.test(s)) return `http://${s}`;
  return `https://${s}`;
}

function waitForTabLoad(tabId, timeoutMs = NAV_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      browser.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      setTimeout(resolve, 400);
    };
    const listener = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    browser.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(finish, timeoutMs);
  });
}

async function navigate(url) {
  const tabId = requireTab();
  const loaded = waitForTabLoad(tabId);
  await browser.tabs.update(tabId, { url: withScheme(url) });
  await loaded;
  return null;
}

async function goBack() {
  const tabId = requireTab();
  const loaded = waitForTabLoad(tabId, 10_000);
  await browser.tabs.goBack(tabId);
  await loaded;
  return null;
}

async function goForward() {
  const tabId = requireTab();
  const loaded = waitForTabLoad(tabId, 10_000);
  await browser.tabs.goForward(tabId);
  await loaded;
  return null;
}

async function takeScreenshot() {
  const tabId = requireTab();
  const dataUrl = await browser.tabs.captureTab(tabId, { format: "png" });
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

// ─── dispatch ─────────────────────────────────────────────────────────────────

async function dispatch(type, payload) {
  switch (type) {
    case "getUrl":             return (await browser.tabs.get(requireTab())).url;
    case "getTitle":           return (await browser.tabs.get(requireTab())).title;
    case "browser_navigate":   return navigate(payload.url);
    case "browser_go_back":    return goBack();
    case "browser_go_forward": return goForward();
    case "browser_screenshot": return takeScreenshot();
    default:                   return sendToContent(type, payload);
  }
}

async function handleFrame(raw) {
  let message;
  try { message = JSON.parse(raw); } catch { return null; }
  if (!message || typeof message.id !== "string" || typeof message.type !== "string") return null;

  try {
    const result = await dispatch(message.type, message.payload ?? {});
    return {
      id: message.id,
      type: MESSAGE_RESPONSE_TYPE,
      payload: { requestId: message.id, result: result === undefined ? null : result },
    };
  } catch (error) {
    return {
      id: message.id,
      type: MESSAGE_RESPONSE_TYPE,
      payload: { requestId: message.id, error: String(error?.message ?? error) },
    };
  }
}

// ─── WebSocket lifecycle ──────────────────────────────────────────────────────

function scheduleReconnect() {
  if (reconnectTimer != null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (wantConnection) openSocket();
  }, RECONNECT_DELAY_MS);
}

function openSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))
    return;

  let ws;
  try { ws = new WebSocket(WS_URL); } catch { scheduleReconnect(); return; }
  socket = ws;

  ws.onopen = () => {
    wsOpen = true;
    refreshBadge();
  };

  ws.onmessage = async (event) => {
    const response = await handleFrame(event.data);
    if (response && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify(response));
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    wsOpen = false;
    refreshBadge();
    if (wantConnection) scheduleReconnect();
  };

  ws.onerror = () => { /* onclose follows */ };
}

function disconnect() {
  wantConnection = false;
  wsOpen = false;
  if (reconnectTimer != null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (socket) {
    try { socket.close(); } catch { /**/ }
    socket = null;
  }
  if (connectedTabId != null) setBadge(connectedTabId, "", null);
  connectedTabId = null;
}

async function connectTab(tabId) {
  if (connectedTabId != null && connectedTabId !== tabId) {
    setBadge(connectedTabId, "", null);
  }
  connectedTabId = tabId;
  wantConnection = true;
  setBadge(tabId, "…", "#f57c00");

  try {
    await ensureContentScript(tabId);
    const pong = await browser.tabs.sendMessage(tabId, { method: "ping", params: {} });
    if (pong !== "pong") throw new Error("content script ping failed");
  } catch (err) {
    console.error(`[firefox-mcp] failed to arm tab ${tabId}:`, err?.message ?? err);
    setBadge(tabId, "!", "#d32f2f");
    wantConnection = false;
    connectedTabId = null;
    return;
  }

  openSocket();
}

// ─── events ───────────────────────────────────────────────────────────────────

// Click toggles connect/disconnect for the active tab.
browser.browserAction.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;
  if (connectedTabId === tab.id && wantConnection) {
    disconnect();
  } else {
    await connectTab(tab.id);
  }
});

// Clean up when the connected tab is closed.
browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId === connectedTabId) disconnect();
});

// Keep badge green through navigations.
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === connectedTabId && wsOpen && changeInfo.status === "loading") {
    setBadge(tabId, "ON", "#2e7d32");
  }
});
