#!/usr/bin/env node

// src/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { program } from "commander";

// src/protocol.ts
var MESSAGE_RESPONSE_TYPE = "messageResponse";
var DEFAULT_WS_PORT = 9009;
function isWireResponse(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  if (v.type !== MESSAGE_RESPONSE_TYPE) return false;
  if (typeof v.id !== "string") return false;
  const p = v.payload;
  return typeof p?.requestId === "string";
}
function generateId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// src/context.ts
var NO_CONNECTION_MESSAGE = "No connection to browser extension. In order to proceed, you must first connect a tab by clicking the Firefox MCP extension icon in the browser toolbar.";
var Context = class {
  _ws;
  pending = /* @__PURE__ */ new Map();
  get ws() {
    if (!this._ws) throw new Error(NO_CONNECTION_MESSAGE);
    return this._ws;
  }
  set ws(ws) {
    this._ws = ws;
    ws.on("message", (data) => this._onMessage(String(data)));
    ws.on("close", () => {
      if (this._ws === ws) this._ws = void 0;
      this._rejectAll("The Firefox extension disconnected.");
    });
    ws.on("error", (err) => console.error("[firefox-mcp] socket error:", err.message));
  }
  hasWs() {
    return !!this._ws;
  }
  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isWireResponse(msg)) return;
    const entry = this.pending.get(msg.payload.requestId);
    if (!entry) return;
    this.pending.delete(msg.payload.requestId);
    clearTimeout(entry.timer);
    if (msg.payload.error) entry.reject(new Error(msg.payload.error));
    else entry.resolve(msg.payload.result);
  }
  _rejectAll(reason) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }
  async sendSocketMessage(type2, payload, options = {}) {
    const ws = this.ws;
    const id = generateId();
    const frame = { id, type: type2, payload: payload ?? {} };
    return new Promise((resolve, reject) => {
      const { timeoutMs = 3e4 } = options;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${type2}".`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve,
        reject,
        timer
      });
      ws.send(JSON.stringify(frame), (err) => {
        if (!err) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      });
    });
  }
  async close() {
    this._rejectAll("Server shutting down.");
    if (!this._ws) return;
    const ws = this._ws;
    this._ws = void 0;
    await new Promise((resolve) => {
      ws.once("close", resolve);
      ws.close();
      setTimeout(resolve, 500);
    });
  }
};

// src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// src/ws.ts
import { WebSocketServer } from "ws";

// src/utils/port.ts
import { execSync } from "child_process";
import net from "net";
async function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => server.close(() => resolve(false)));
    server.listen(port, "127.0.0.1");
  });
}
function killProcessOnPort(port) {
  try {
    if (process.platform === "win32") {
      execSync(
        `FOR /F "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`
      );
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`);
    }
  } catch {
  }
}
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/ws.ts
async function createWebSocketServer(context, port = DEFAULT_WS_PORT) {
  killProcessOnPort(port);
  while (await isPortInUse(port)) {
    await wait(100);
  }
  const wss = new WebSocketServer({ port, host: "127.0.0.1" });
  wss.on("listening", () => {
    console.error(`[firefox-mcp] WebSocket bridge listening on ws://127.0.0.1:${port}`);
  });
  wss.on("connection", (ws) => {
    if (context.hasWs()) {
      context.ws.close();
    }
    context.ws = ws;
  });
  return wss;
}

// src/server.ts
async function createServerWithTools(options) {
  const { name, version, tools: tools2, resources: resources2, port } = options;
  const context = new Context();
  const server = new Server(
    { name, version },
    { capabilities: { tools: {}, resources: {} } }
  );
  const wss = await createWebSocketServer(context, port);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools2.map((t) => t.schema)
  }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources2.map((r) => r.schema)
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools2.find((t) => t.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Tool "${request.params.name}" not found` }],
        isError: true
      };
    }
    try {
      return await tool.handle(context, request.params.arguments);
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true
      };
    }
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources2.find((r) => r.schema.uri === request.params.uri);
    if (!resource) return { contents: [] };
    const contents = await resource.read(context, request.params.uri);
    return { contents };
  });
  const originalClose = server.close.bind(server);
  server.close = async () => {
    await originalClose();
    await new Promise((resolve) => wss.close(() => resolve()));
    await context.close();
  };
  return server;
}

// src/tools/common.ts
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// src/utils/aria-snapshot.ts
async function captureAriaSnapshot(context, status = "") {
  const url = await context.sendSocketMessage("getUrl", void 0);
  const title = await context.sendSocketMessage("getTitle", void 0);
  const snapshot2 = await context.sendSocketMessage("browser_snapshot", {});
  return {
    content: [
      {
        type: "text",
        text: `${status ? `${status}
` : ""}
- Page URL: ${url}
- Page Title: ${title}
- Page Snapshot
\`\`\`yaml
${snapshot2}
\`\`\`
`
      }
    ]
  };
}

// src/tools/tool.ts
function textResult(text) {
  return { content: [{ type: "text", text }] };
}

// src/tools/common.ts
var NavigateArgs = z.object({ url: z.string().describe("The URL to navigate to") });
var navigate = (snapshot2) => ({
  schema: {
    name: "browser_navigate",
    description: "Navigate to a URL",
    inputSchema: zodToJsonSchema(NavigateArgs)
  },
  handle: async (context, params) => {
    const { url } = NavigateArgs.parse(params);
    await context.sendSocketMessage("browser_navigate", { url }, { timeoutMs: 6e4 });
    if (snapshot2) return captureAriaSnapshot(context);
    return textResult(`Navigated to ${url}`);
  }
});
var goBack = (snapshot2) => ({
  schema: {
    name: "browser_go_back",
    description: "Go back to the previous page",
    inputSchema: zodToJsonSchema(z.object({}))
  },
  handle: async (context) => {
    await context.sendSocketMessage("browser_go_back", {}, { timeoutMs: 6e4 });
    if (snapshot2) return captureAriaSnapshot(context);
    return textResult("Navigated back");
  }
});
var goForward = (snapshot2) => ({
  schema: {
    name: "browser_go_forward",
    description: "Go forward to the next page",
    inputSchema: zodToJsonSchema(z.object({}))
  },
  handle: async (context) => {
    await context.sendSocketMessage("browser_go_forward", {}, { timeoutMs: 6e4 });
    if (snapshot2) return captureAriaSnapshot(context);
    return textResult("Navigated forward");
  }
});
var WaitArgs = z.object({ time: z.number().describe("The time to wait in seconds") });
var wait2 = {
  schema: {
    name: "browser_wait",
    description: "Wait for a specified time in seconds",
    inputSchema: zodToJsonSchema(WaitArgs)
  },
  handle: async (_context, params) => {
    const { time } = WaitArgs.parse(params);
    await new Promise((resolve) => setTimeout(resolve, Math.min(time, 300) * 1e3));
    return textResult(`Waited for ${time} seconds`);
  }
};
var PressKeyArgs = z.object({
  key: z.string().describe(
    "Name of the key to press or a character to generate, such as `ArrowLeft` or `a`"
  )
});
var pressKey = {
  schema: {
    name: "browser_press_key",
    description: "Press a key on the keyboard",
    inputSchema: zodToJsonSchema(PressKeyArgs)
  },
  handle: async (context, params) => {
    const { key } = PressKeyArgs.parse(params);
    await context.sendSocketMessage("browser_press_key", { key });
    return textResult(`Pressed key ${key}`);
  }
};

// src/tools/custom.ts
import { z as z2 } from "zod";
import { zodToJsonSchema as zodToJsonSchema2 } from "zod-to-json-schema";
var getConsoleLogs = {
  schema: {
    name: "browser_get_console_logs",
    description: "Get the console logs from the browser",
    inputSchema: zodToJsonSchema2(z2.object({}))
  },
  handle: async (context) => {
    const logs = await context.sendSocketMessage(
      "browser_get_console_logs",
      {}
    );
    const text = logs.map((log) => JSON.stringify(log)).join("\n");
    return {
      content: [{ type: "text", text: text.length ? text : "(no console output)" }]
    };
  }
};
var screenshot = {
  schema: {
    name: "browser_screenshot",
    description: "Take a screenshot of the current page",
    inputSchema: zodToJsonSchema2(z2.object({}))
  },
  handle: async (context) => {
    const data = await context.sendSocketMessage(
      "browser_screenshot",
      {},
      { timeoutMs: 6e4 }
    );
    return {
      content: [{ type: "image", data, mimeType: "image/png" }]
    };
  }
};

// src/tools/snapshot.ts
import { z as z3 } from "zod";
import zodToJsonSchema3 from "zod-to-json-schema";
var ElementSchema = z3.object({
  element: z3.string().describe(
    "Human-readable element description used to obtain permission to interact with the element"
  ),
  ref: z3.string().describe("Exact target element reference from the page snapshot")
});
var snapshot = {
  schema: {
    name: "browser_snapshot",
    description: "Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with.",
    inputSchema: zodToJsonSchema3(z3.object({}))
  },
  handle: async (context) => captureAriaSnapshot(context)
};
var click = {
  schema: {
    name: "browser_click",
    description: "Perform click on a web page",
    inputSchema: zodToJsonSchema3(ElementSchema)
  },
  handle: async (context, params) => {
    const { element, ref } = ElementSchema.parse(params);
    await context.sendSocketMessage("browser_click", { element, ref });
    const snap = await captureAriaSnapshot(context);
    return { content: [{ type: "text", text: `Clicked "${element}"` }, ...snap.content] };
  }
};
var hover = {
  schema: {
    name: "browser_hover",
    description: "Hover over element on page",
    inputSchema: zodToJsonSchema3(ElementSchema)
  },
  handle: async (context, params) => {
    const { element, ref } = ElementSchema.parse(params);
    await context.sendSocketMessage("browser_hover", { element, ref });
    const snap = await captureAriaSnapshot(context);
    return { content: [{ type: "text", text: `Hovered over "${element}"` }, ...snap.content] };
  }
};
var TypeArgs = ElementSchema.extend({
  text: z3.string().describe("Text to type into the element"),
  submit: z3.boolean().optional().describe("Whether to submit entered text (press Enter after)")
});
var type = {
  schema: {
    name: "browser_type",
    description: "Type text into editable element",
    inputSchema: zodToJsonSchema3(TypeArgs)
  },
  handle: async (context, params) => {
    const { element, ref, text, submit } = TypeArgs.parse(params);
    await context.sendSocketMessage("browser_type", { element, ref, text, submit: submit ?? false });
    const snap = await captureAriaSnapshot(context);
    return { content: [{ type: "text", text: `Typed "${text}" into "${element}"` }, ...snap.content] };
  }
};
var SelectOptionArgs = ElementSchema.extend({
  values: z3.array(z3.string()).describe(
    "Array of values to select in the dropdown. This can be a single value or multiple values."
  )
});
var selectOption = {
  schema: {
    name: "browser_select_option",
    description: "Select an option in a dropdown",
    inputSchema: zodToJsonSchema3(SelectOptionArgs)
  },
  handle: async (context, params) => {
    const { element, ref, values } = SelectOptionArgs.parse(params);
    await context.sendSocketMessage("browser_select_option", { element, ref, values });
    const snap = await captureAriaSnapshot(context);
    return { content: [{ type: "text", text: `Selected option in "${element}"` }, ...snap.content] };
  }
};
var DragArgs = z3.object({
  startElement: z3.string().describe(
    "Human-readable source element description used to obtain the permission to interact with the element"
  ),
  startRef: z3.string().describe("Exact source element reference from the page snapshot"),
  endElement: z3.string().describe(
    "Human-readable target element description used to obtain the permission to interact with the element"
  ),
  endRef: z3.string().describe("Exact target element reference from the page snapshot")
});
var drag = {
  schema: {
    name: "browser_drag",
    description: "Perform drag and drop between two elements",
    inputSchema: zodToJsonSchema3(DragArgs)
  },
  handle: async (context, params) => {
    const { startElement, startRef, endElement, endRef } = DragArgs.parse(params);
    await context.sendSocketMessage("browser_drag", { startElement, startRef, endElement, endRef });
    const snap = await captureAriaSnapshot(context);
    return {
      content: [
        { type: "text", text: `Dragged "${startElement}" to "${endElement}"` },
        ...snap.content
      ]
    };
  }
};

// src/index.ts
var NAME = "Firefox MCP";
var VERSION = "0.1.0";
function setupExitWatchdog(server) {
  process.stdin.on("close", async () => {
    setTimeout(() => process.exit(0), 15e3);
    await server.close();
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });
}
var tools = [
  navigate(true),
  goBack(true),
  goForward(true),
  snapshot,
  click,
  hover,
  type,
  selectOption,
  drag,
  pressKey,
  wait2,
  getConsoleLogs,
  screenshot
];
var resources = [];
program.name("firefox-mcp").description(
  "MCP server that drives your real, logged-in Firefox through a WebExtension bridge."
).version(`Version ${VERSION}`).option(
  "-p, --port <port>",
  `WebSocket port the extension connects back to (default: ${DEFAULT_WS_PORT})`,
  (v) => Number(v),
  DEFAULT_WS_PORT
);
program.action(async () => {
  const opts = program.opts();
  const server = await createServerWithTools({
    name: NAME,
    version: VERSION,
    tools,
    resources,
    port: opts.port
  });
  setupExitWatchdog(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[firefox-mcp] MCP server ready (pid ${process.pid})`);
});
program.parse(process.argv);
