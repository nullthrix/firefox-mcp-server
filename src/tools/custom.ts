import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool } from "./tool.js";

// ── getConsoleLogs ────────────────────────────────────────────────────────────

export const getConsoleLogs: Tool = {
  schema: {
    name: "browser_get_console_logs",
    description: "Get the console logs from the browser",
    inputSchema: zodToJsonSchema(z.object({})) as Record<string, unknown>,
  },
  handle: async (context) => {
    const logs = await context.sendSocketMessage<Array<Record<string, unknown>>>(
      "browser_get_console_logs",
      {},
    );
    const text = logs.map((log) => JSON.stringify(log)).join("\n");
    return {
      content: [{ type: "text", text: text.length ? text : "(no console output)" }],
    };
  },
};

// ── screenshot ────────────────────────────────────────────────────────────────

export const screenshot: Tool = {
  schema: {
    name: "browser_screenshot",
    description: "Take a screenshot of the current page",
    inputSchema: zodToJsonSchema(z.object({})) as Record<string, unknown>,
  },
  handle: async (context) => {
    const data = await context.sendSocketMessage<string>("browser_screenshot", {}, {
      timeoutMs: 60_000,
    });
    return {
      content: [{ type: "image", data, mimeType: "image/png" }],
    };
  },
};
