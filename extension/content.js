"use strict";

/**
 * Firefox MCP — content script
 *
 * Injected into every tab. Provides:
 *   - ARIA accessibility tree snapshot (YAML-like, with ref IDs)
 *   - Element interactions: click, hover, type, selectOption, drag, pressKey
 *   - Console log capture (both content-script world and page world via Xray)
 *
 * All refs are scoped per-document: navigation wipes them and stale refs fail loudly.
 */

(() => {
  if (window.__firefoxMcpInjected) return;
  window.__firefoxMcpInjected = true;

  const MAX_NODES = 4000;
  const MAX_NAME_LEN = 300;
  const MAX_LOGS = 1000;

  // ─── console capture ────────────────────────────────────────────────────────

  /** @type {Array<{type:string,text:string,timestamp:number}>} */
  const consoleLogs = [];

  function stringify(value, depth = 0) {
    try {
      if (value === undefined) return "undefined";
      if (value === null) return "null";
      const t = typeof value;
      if (t === "string") return value;
      if (t === "number" || t === "boolean" || t === "bigint") return String(value);
      if (t === "symbol") return value.toString();
      if (t === "function") return `[Function ${value.name || "anonymous"}]`;
      if (value instanceof Error) return `${value.name}: ${value.message}`;
      if (depth > 1) return Array.isArray(value) ? "[…]" : "{…}";
      if (Array.isArray(value))
        return `[${value.slice(0, 20).map((x) => stringify(x, depth + 1)).join(", ")}]`;
      if (typeof value.nodeType === "number" && typeof value.nodeName === "string")
        return `<${String(value.nodeName).toLowerCase()}${value.id ? "#" + value.id : ""}>`;
      const json = JSON.stringify(value);
      if (json && json !== "{}") return json;
      return `{${Object.getOwnPropertyNames(value).slice(0, 20)
        .map((k) => `${k}: ${stringify(value[k], depth + 1)}`).join(", ")}}`;
    } catch { return "[unserializable]"; }
  }

  function recordLog(level, args) {
    try {
      consoleLogs.push({
        type: level,
        text: Array.prototype.map.call(args, (a) => stringify(a)).join(" "),
        timestamp: Date.now(),
      });
      if (consoleLogs.length > MAX_LOGS) consoleLogs.shift();
    } catch { /* never break the page */ }
  }

  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const orig = console[level];
    if (typeof orig !== "function") continue;
    console[level] = function (...args) {
      recordLog(level, args);
      return orig.apply(console, args);
    };
  }

  // Patch the *page world* console via Xray (Firefox content-script sandbox globals)
  (() => {
    try {
      const pw = window.wrappedJSObject;
      if (!pw?.console || typeof exportFunction !== "function") return;
      for (const level of ["log", "info", "warn", "error", "debug"]) {
        const orig = pw.console[level];
        if (typeof orig !== "function") continue;
        pw.console[level] = exportFunction(function (...args) {
          recordLog(level, args);
          return orig.apply(pw.console, args);
        }, pw);
      }
    } catch { /* best effort */ }
  })();

  window.addEventListener("error", (ev) => {
    try {
      const where = ev.filename ? ` (${ev.filename}:${ev.lineno}:${ev.colno})` : "";
      recordLog("error", [`Uncaught ${ev.message}${where}`]);
    } catch { /**/ }
  }, true);

  window.addEventListener("unhandledrejection", (ev) => {
    try { recordLog("error", [`Unhandled rejection: ${stringify(ev.reason)}`]); }
    catch { /**/ }
  });

  // ─── ref registry ────────────────────────────────────────────────────────────

  let refSeq = 0;
  let refMap = new Map(); // ref → Element

  function newRef(el) {
    const ref = `e${++refSeq}`;
    refMap.set(ref, el);
    return ref;
  }

  function resolveRef(ref) {
    const el = refMap.get(String(ref));
    if (!el)
      throw new Error(`Ref "${ref}" is unknown — the page changed. Call browser_snapshot again.`);
    if (!el.isConnected)
      throw new Error(`Ref "${ref}" is no longer in the DOM. Call browser_snapshot again.`);
    return el;
  }

  // ─── ARIA roles / names ───────────────────────────────────────────────────────

  const SKIP_TAGS = new Set([
    "script","style","head","meta","link","title","base","noscript",
    "template","param","source","track","br","wbr",
  ]);

  const NAME_FROM_CONTENTS = new Set([
    "button","caption","cell","checkbox","columnheader","definition",
    "gridcell","heading","link","listitem","menuitem","menuitemcheckbox",
    "menuitemradio","option","paragraph","radio","rowheader","switch",
    "tab","term","tooltip","treeitem",
  ]);

  function norm(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

  function isNamed(el) {
    return !!(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby"));
  }

  function hasTableSemantics(table) {
    if (!table) return false;
    if (table.getAttribute("role")) return true;
    if (table.querySelector("caption,th")) return true;
    return false;
  }

  function implicitRole(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    switch (tag) {
      case "a": case "area": return el.hasAttribute("href") ? "link" : null;
      case "button": return "button";
      case "input":
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "range") return "slider";
        if (type === "number") return "spinbutton";
        if (type === "search") return "searchbox";
        if (["button","submit","reset","image","file"].includes(type)) return "button";
        if (type === "hidden") return null;
        return "textbox";
      case "select": return el.multiple ? "listbox" : "combobox";
      case "textarea": return "textbox";
      case "option": return "option";
      case "optgroup": return "group";
      case "datalist": return "listbox";
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
      case "img": return (el.getAttribute("alt") || isNamed(el)) ? "img" : null;
      case "svg": return isNamed(el) ? "img" : null;
      case "ul": case "ol": case "menu": return "list";
      case "li": return "listitem";
      case "dl": return "list";
      case "dt": return "term";
      case "dd": return "definition";
      case "table": return hasTableSemantics(el) ? "table" : null;
      case "tr": return hasTableSemantics(el.closest("table")) ? "row" : null;
      case "td": return hasTableSemantics(el.closest("table")) ? "cell" : null;
      case "th": return hasTableSemantics(el.closest("table")) ? "columnheader" : null;
      case "caption": return "caption";
      case "nav": return "navigation";
      case "main": return "main";
      case "header":
        return el.closest("article,aside,main,nav,section") ? null : "banner";
      case "footer":
        return el.closest("article,aside,main,nav,section") ? null : "contentinfo";
      case "aside": return "complementary";
      case "section": return isNamed(el) ? "region" : null;
      case "form": return isNamed(el) ? "form" : null;
      case "dialog": return "dialog";
      case "fieldset": return "group";
      case "iframe": return "iframe";
      case "progress": return "progressbar";
      case "meter": return "meter";
      case "output": return "status";
      case "summary": return "button";
      case "details": return "group";
      case "figure": return "figure";
      case "hr": return "separator";
      case "blockquote": return "blockquote";
      case "search": return "search";
      default: return null;
    }
  }

  function roleFor(el) {
    const explicit = norm(el.getAttribute("role")).split(" ")[0];
    if (explicit && explicit !== "presentation" && explicit !== "none") return explicit.toLowerCase();
    if (explicit === "presentation" || explicit === "none") return null;
    const implicit = implicitRole(el);
    if (implicit) return implicit;
    if (el.getAttribute("contenteditable") === "true") return "textbox";
    return null;
  }

  function textOf(el) {
    const t = norm(el.textContent);
    return t.length > MAX_NAME_LEN ? t.slice(0, MAX_NAME_LEN) + "…" : t;
  }

  function labelsFor(el) {
    try {
      if (el.labels?.length)
        return norm(Array.prototype.map.call(el.labels, textOf).join(" "));
    } catch { /**/ }
    if (el.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) return textOf(lbl);
      } catch { /**/ }
    }
    const wrap = el.closest("label");
    return wrap ? textOf(wrap) : "";
  }

  function accessibleName(el, role) {
    const aria = norm(el.getAttribute("aria-label"));
    if (aria) return aria;

    const lby = norm(el.getAttribute("aria-labelledby"));
    if (lby) {
      const parts = lby.split(" ")
        .map((id) => document.getElementById(id))
        .filter(Boolean).map(textOf).filter(Boolean);
      if (parts.length) return norm(parts.join(" "));
    }

    const tag = el.tagName.toLowerCase();
    if (tag === "img" || tag === "area") {
      const alt = norm(el.getAttribute("alt"));
      if (alt) return alt;
    }

    if (["input","textarea","select"].includes(tag)) {
      const lbl = labelsFor(el);
      if (lbl) return lbl;
      const ph = norm(el.getAttribute("placeholder"));
      if (ph) return ph;
      const ti = norm(el.getAttribute("title"));
      if (ti) return ti;
      if (tag === "input") {
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (["button","submit","reset"].includes(type)) return norm(el.value);
      }
      return "";
    }

    if (NAME_FROM_CONTENTS.has(role)) return textOf(el);

    const title = norm(el.getAttribute("title"));
    if (title) return title;
    return "";
  }

  // ─── visibility ──────────────────────────────────────────────────────────────

  function isVisible(el, style) {
    if (!el.isConnected || el.hidden) return false;
    if (style.display === "none") return false;
    if (style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (parseFloat(style.opacity) === 0) return false;
    if (style.display === "contents") return true;
    const tag = el.tagName.toLowerCase();
    if (tag === "option" || tag === "optgroup") return true;
    const r = el.getBoundingClientRect();
    return !(r.width === 0 && r.height === 0);
  }

  // ─── snapshot ────────────────────────────────────────────────────────────────

  function childNodesOf(el) {
    const nodes = Array.prototype.slice.call(el.childNodes);
    try { if (el.shadowRoot) nodes.push(...el.shadowRoot.childNodes); } catch { /**/ }
    return nodes;
  }

  function stateAttrs(el, role) {
    const attrs = [];
    const tag = el.tagName.toLowerCase();
    if (role === "heading") {
      const m = tag.match(/^h([1-6])$/);
      const lvl = m ? m[1] : el.getAttribute("aria-level");
      if (lvl) attrs.push(`level=${lvl}`);
    }
    if (el.disabled || el.getAttribute("aria-disabled") === "true") attrs.push("disabled");
    if (el.required || el.getAttribute("aria-required") === "true") attrs.push("required");
    if (el.readOnly || el.getAttribute("aria-readonly") === "true") attrs.push("readonly");
    if (["checkbox","radio","switch","menuitemcheckbox","menuitemradio"].includes(role)) {
      const chk = el.getAttribute("aria-checked");
      if (chk === "mixed") attrs.push("checked=mixed");
      else if (chk === "true" || el.checked) attrs.push("checked");
    }
    if (["option","tab","treeitem","row"].includes(role)) {
      if (el.getAttribute("aria-selected") === "true" || el.selected) attrs.push("selected");
    }
    for (const [a, lbl] of [
      ["aria-expanded","expanded"],["aria-pressed","pressed"],
      ["aria-invalid","invalid"],["aria-busy","busy"],["aria-modal","modal"],
    ]) {
      if (el.getAttribute(a) === "true") attrs.push(lbl);
    }
    if (el.open === true) attrs.push("open");
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (el === document.activeElement && type !== "hidden") attrs.push("focused");
    return attrs;
  }

  function valueOf(el, role) {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      return Array.prototype.filter.call(el.options, (o) => o.selected)
        .map((o) => norm(o.textContent)).filter(Boolean).join(", ");
    }
    if (tag === "input" || tag === "textarea") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "password") return el.value ? "••••••" : "";
      if (["checkbox","radio","file","submit","button","reset","image","hidden"].includes(type)) return "";
      return norm(el.value);
    }
    if (role === "textbox" && el.getAttribute("contenteditable") === "true")
      return norm(el.textContent);
    if (["slider","spinbutton","progressbar","meter"].includes(role)) {
      const now = el.getAttribute("aria-valuenow");
      if (now) return `${now}${el.getAttribute("aria-valuetext") ? ` (${el.getAttribute("aria-valuetext")})` : ""}`;
    }
    return "";
  }

  function renderNode(el, role, name, ref) {
    let line = role;
    if (name) line += ` ${JSON.stringify(name)}`;
    for (const a of stateAttrs(el, role)) line += ` [${a}]`;
    line += ` [ref=${ref}]`;
    const val = valueOf(el, role);
    if (val) line += `: ${val.replace(/\n+/g, " ")}`;
    return line;
  }

  function buildSnapshot() {
    refSeq = 0;
    refMap = new Map();
    const root = document.body || document.documentElement;
    if (!root) return "(empty document)";
    const lines = [];
    const budget = { count: 0 };
    walkNode(root, 0, lines, budget);
    return lines.length ? lines.join("\n") : "(no visible content)";
  }

  const INDENT = "  ";

  function walkNode(node, depth, lines, budget) {
    if (budget.count > MAX_NODES) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const t = norm(node.nodeValue);
      if (t) lines.push(INDENT.repeat(depth) + `- text: ${JSON.stringify(t)}`);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (el.getAttribute("aria-hidden") === "true") return;

    let style;
    try { style = getComputedStyle(el); } catch { return; }
    if (!isVisible(el, style)) return;

    budget.count++;

    let role = roleFor(el);
    if (role === null) {
      const clickable = el.hasAttribute("onclick") || el.tabIndex >= 0;
      if (clickable) role = "generic";
    }

    const isLabel = tag === "label";

    if (role === null) {
      for (const child of childNodesOf(el)) {
        if (isLabel && child.nodeType === Node.TEXT_NODE) continue;
        walkNode(child, depth, lines, budget);
      }
      return;
    }

    const name = accessibleName(el, role);
    const ref = newRef(el);
    lines.push(INDENT.repeat(depth) + `- ${renderNode(el, role, name, ref)}`);

    const skipText = NAME_FROM_CONTENTS.has(role) ||
      ["input","textarea","select","option","optgroup"].includes(tag) ||
      el.getAttribute("contenteditable") === "true";

    for (const child of childNodesOf(el)) {
      if (skipText && child.nodeType === Node.TEXT_NODE) continue;
      walkNode(child, depth + 1, lines, budget);
    }
  }

  // ─── interaction helpers ──────────────────────────────────────────────────────

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function scrollIntoView(el) {
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch { /**/ }
  }

  function fireMouse(el, type, opts) {
    try { return el.dispatchEvent(new MouseEvent(type, opts)); } catch { return true; }
  }

  function firePointer(el, type, opts) {
    try {
      if (typeof PointerEvent === "function") el.dispatchEvent(new PointerEvent(type, opts));
    } catch { /**/ }
  }

  // ─── click ────────────────────────────────────────────────────────────────────

  function doClick(ref) {
    const el = resolveRef(ref);
    scrollIntoView(el);
    const { x, y } = centerOf(el);
    const base = {
      bubbles: true, cancelable: true, composed: true, view: window,
      detail: 1, button: 0, clientX: x, clientY: y, screenX: x, screenY: y,
    };
    const toggles = el.matches("input[type=checkbox],input[type=radio]");
    const before = toggles ? el.checked : null;

    const submitter = el.matches("button[type=submit],button:not([type]),input[type=submit],input[type=image]")
      ? el : null;
    const form = submitter ? submitter.form : null;
    let submitted = false;
    const onSubmit = () => { submitted = true; };
    if (form) form.addEventListener("submit", onSubmit);

    firePointer(el, "pointerover",  { ...base, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true });
    firePointer(el, "pointerenter", { ...base, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true });
    fireMouse(el, "mouseover",  { ...base, buttons: 0 });
    fireMouse(el, "mouseenter", { ...base, buttons: 0 });
    firePointer(el, "pointerdown", { ...base, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true });
    fireMouse(el, "mousedown", { ...base, buttons: 1 });
    try { if (typeof el.focus === "function") el.focus({ preventScroll: true }); } catch { /**/ }
    firePointer(el, "pointerup", { ...base, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true });
    fireMouse(el, "mouseup", { ...base, buttons: 0 });
    const notPrevented = fireMouse(el, "click", { ...base, buttons: 0 });

    if (form) form.removeEventListener("submit", onSubmit);
    if (form && notPrevented && !submitted) {
      try { form.requestSubmit(submitter); } catch {
        try { form.requestSubmit(); } catch { /**/ }
      }
    }
    if (toggles && el.checked === before) {
      try { el.click(); } catch { /**/ }
    }
    return null;
  }

  // ─── hover ────────────────────────────────────────────────────────────────────

  function doHover(ref) {
    const el = resolveRef(ref);
    scrollIntoView(el);
    const { x, y } = centerOf(el);
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y };
    firePointer(el, "pointerover",  { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true });
    firePointer(el, "pointerenter", { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true });
    fireMouse(el, "mouseover",  base);
    fireMouse(el, "mouseenter", base);
    fireMouse(el, "mousemove",  base);
    return null;
  }

  // ─── type ─────────────────────────────────────────────────────────────────────

  function setNativeValue(el, value) {
    const proto = el.tagName.toLowerCase() === "textarea"
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value); else el.value = value;
  }

  function fireInput(el, data) {
    try {
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true, composed: true, data: data ?? null, inputType: "insertText",
      }));
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
  }

  function fireChange(el) {
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function doType({ ref, text, submit, slowly }) {
    const el = resolveRef(ref);
    scrollIntoView(el);
    try { if (typeof el.focus === "function") el.focus({ preventScroll: true }); } catch { /**/ }

    if (el.getAttribute("contenteditable") === "true" && !el.matches("input,textarea")) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      let ok = false;
      try { ok = document.execCommand("insertText", false, text); } catch { /**/ }
      if (!ok) { el.textContent = text; fireInput(el, text); }
      fireChange(el);
    } else if (slowly) {
      setNativeValue(el, "");
      fireInput(el, "");
      for (const char of text) { setNativeValue(el, el.value + char); fireInput(el, char); }
      fireChange(el);
    } else {
      setNativeValue(el, text);
      fireInput(el, text);
      fireChange(el);
    }

    if (submit === true) doPressKey("Enter");
    return null;
  }

  // ─── selectOption ────────────────────────────────────────────────────────────

  function doSelectOption(ref, values) {
    const el = resolveRef(ref);
    if (el.tagName.toLowerCase() !== "select")
      throw new Error("browser_select_option requires a <select> element.");
    const wanted = new Set((values || []).map(String));
    let matched = 0;
    for (const opt of Array.prototype.slice.call(el.options)) {
      const hit = wanted.has(opt.value) || wanted.has(norm(opt.label)) || wanted.has(norm(opt.textContent));
      if (hit) { opt.selected = true; matched++; }
      else if (!el.multiple) opt.selected = false;
    }
    if (!matched)
      throw new Error(`No <option> matched ${JSON.stringify(Array.from(wanted))}.`);
    fireInput(el, null);
    fireChange(el);
    return null;
  }

  // ─── drag ─────────────────────────────────────────────────────────────────────

  function doDrag(startRef, endRef) {
    const src = resolveRef(startRef);
    const tgt = resolveRef(endRef);
    scrollIntoView(src);
    scrollIntoView(tgt);
    const from = centerOf(src);
    const to   = centerOf(tgt);
    const base = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
    let dt;
    try { dt = new DataTransfer(); } catch { dt = undefined; }

    const dn = { ...base, clientX: from.x, clientY: from.y, dataTransfer: dt };
    firePointer(src, "pointerdown", { ...dn, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true });
    fireMouse(src, "mousedown", { ...dn, buttons: 1 });
    try { src.dispatchEvent(new DragEvent("dragstart", dn)); } catch { /**/ }

    for (let i = 1; i <= 8; i++) {
      const x = from.x + (to.x - from.x) * i / 8;
      const y = from.y + (to.y - from.y) * i / 8;
      const mv = { ...base, buttons: 1, clientX: x, clientY: y, dataTransfer: dt };
      fireMouse(src, "mousemove", mv);
      fireMouse(document, "mousemove", mv);
      try { tgt.dispatchEvent(new DragEvent("dragover", mv)); } catch { /**/ }
    }

    const up = { ...base, buttons: 0, clientX: to.x, clientY: to.y, dataTransfer: dt };
    try { tgt.dispatchEvent(new DragEvent("drop", up)); } catch { /**/ }
    firePointer(tgt, "pointerup", { ...up, pointerId: 1, pointerType: "mouse", isPrimary: true });
    fireMouse(tgt, "mouseup", up);
    try { src.dispatchEvent(new DragEvent("dragend", up)); } catch { /**/ }
    return null;
  }

  // ─── pressKey ─────────────────────────────────────────────────────────────────

  const KEY_TABLE = {
    Enter:      { code: "Enter",     keyCode: 13, printable: false },
    Tab:        { code: "Tab",       keyCode: 9,  printable: false },
    Escape:     { code: "Escape",    keyCode: 27, printable: false },
    Backspace:  { code: "Backspace", keyCode: 8,  printable: false },
    Delete:     { code: "Delete",    keyCode: 46, printable: false },
    Home:       { code: "Home",      keyCode: 36, printable: false },
    End:        { code: "End",       keyCode: 35, printable: false },
    PageUp:     { code: "PageUp",    keyCode: 33, printable: false },
    PageDown:   { code: "PageDown",  keyCode: 34, printable: false },
    ArrowUp:    { code: "ArrowUp",   keyCode: 38, printable: false },
    ArrowDown:  { code: "ArrowDown", keyCode: 40, printable: false },
    ArrowLeft:  { code: "ArrowLeft", keyCode: 37, printable: false },
    ArrowRight: { code: "ArrowRight",keyCode: 39, printable: false },
    " ":        { code: "Space",     keyCode: 32, printable: true  },
  };

  function describeKey(key) {
    if (KEY_TABLE[key]) return { key, ...KEY_TABLE[key] };
    if ([...key].length === 1) {
      const upper = key.toUpperCase();
      const code = /[a-z]/i.test(key) ? `Key${upper}` : /[0-9]/.test(key) ? `Digit${key}` : "";
      return { key, code, keyCode: upper.charCodeAt(0), printable: true };
    }
    return { key, code: key, keyCode: 0, printable: false };
  }

  function doPressKey(key) {
    const spec = describeKey(String(key));
    const target = document.activeElement || document.body || document.documentElement;
    if (!target) throw new Error("No element to send the key to.");
    const base = {
      bubbles: true, cancelable: true, composed: true, view: window,
      key: spec.key, code: spec.code, keyCode: spec.keyCode, which: spec.keyCode,
    };
    const notPrevented = target.dispatchEvent(new KeyboardEvent("keydown", base));
    if (spec.printable) target.dispatchEvent(new KeyboardEvent("keypress", base));
    target.dispatchEvent(new KeyboardEvent("keyup", base));

    if (spec.key === "Enter" && notPrevented) {
      const active = document.activeElement;
      if (active?.form && typeof active.form.requestSubmit === "function") {
        active.form.requestSubmit();
      } else if (active?.tagName === "A" && active.href) {
        active.click();
      }
    }
    return null;
  }

  // ─── message dispatcher ───────────────────────────────────────────────────────

  async function dispatch(method, params) {
    switch (method) {
      case "ping":                  return "pong";
      case "browser_snapshot":      return buildSnapshot();
      case "browser_click":         return doClick(params.ref);
      case "browser_hover":         return doHover(params.ref);
      case "browser_type":          return doType(params);
      case "browser_select_option": return doSelectOption(params.ref, params.values);
      case "browser_drag":          return doDrag(params.startRef, params.endRef);
      case "browser_press_key":     return doPressKey(params.key);
      case "browser_get_console_logs": return consoleLogs.slice();
      default:
        throw new Error(`Unknown method "${method}".`);
    }
  }

  const api = typeof browser !== "undefined" ? browser : chrome;
  api.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.method !== "string") return undefined;
    try {
      return Promise.resolve(dispatch(message.method, message.params || {}));
    } catch (err) {
      return Promise.reject(new Error(String(err?.message ?? err)));
    }
  });
})();
