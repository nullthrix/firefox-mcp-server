import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { captureAriaSnapshot } from "@/utils/aria-snapshot.js";
import { requireString, textResult, type Tool, type ToolFactory } from "./tool.js";

// ── Shared element schema ──────────────────────────────────────────────────────

const ElementSchema = z.object({
  element: z
    .string()
    .describe("Human-readable element description used to obtain permission to interact with the element"),
  ref: z.string().describe("Exact target element reference from the page snapshot"),
});

// ── navigate ──────────────────────────────────────────────────────────────────

const NavigateArgs = z.object({ url: z.string().describe("The URL to navigate to") });

export const navigate: ToolFactory = (snapshot) => ({
  schema: {
    name: "browser_navigate",
    description: "Navigate to a URL",
    inputSchema: zodToJsonSchema(NavigateArgs) as Record<string, unknown>,
  },
  handle: async (context, params) => {
    const { url } = NavigateArgs.parse(params);
    await context.sendSocketMessage("browser_navigate", { url }, { timeoutMs: 60_000 });
    if (snapshot) return captureAriaSnapshot(context);
    return textResult(`Navigated to ${url}`);
  },
});

// ── goBack ────────────────────────────────────────────────────────────────────

export const goBack: ToolFactory = (snapshot) => ({
  schema: {
    name: "browser_go_back",
    description: "Go back to the previous page",
    inputSchema: zodToJsonSchema(z.object({})) as Record<string, unknown>,
  },
  handle: async (context) => {
    await context.sendSocketMessage("browser_go_back", {}, { timeoutMs: 60_000 });
    if (snapshot) return captureAriaSnapshot(context);
    return textResult("Navigated back");
  },
});

// ── goForward ─────────────────────────────────────────────────────────────────

export const goForward: ToolFactory = (snapshot) => ({
  schema: {
    name: "browser_go_forward",
    description: "Go forward to the next page",
    inputSchema: zodToJsonSchema(z.object({})) as Record<string, unknown>,
  },
  handle: async (context) => {
    await context.sendSocketMessage("browser_go_forward", {}, { timeoutMs: 60_000 });
    if (snapshot) return captureAriaSnapshot(context);
    return textResult("Navigated forward");
  },
});

// ── wait ──────────────────────────────────────────────────────────────────────

const WaitArgs = z.object({ time: z.number().describe("The time to wait in seconds") });

export const wait: Tool = {
  schema: {
    name: "browser_wait",
    description: "Wait for a specified time in seconds",
    inputSchema: zodToJsonSchema(WaitArgs) as Record<string, unknown>,
  },
  handle: async (_context, params) => {
    const { time } = WaitArgs.parse(params);
    await new Promise((resolve) => setTimeout(resolve, Math.min(time, 300) * 1000));
    return textResult(`Waited for ${time} seconds`);
  },
};

// ── pressKey ──────────────────────────────────────────────────────────────────

const PressKeyArgs = z.object({
  key: z
    .string()
    .describe("Name of the key to press or a character to generate, such as `ArrowLeft` or `a`"),
});

export const pressKey: Tool = {
  schema: {
    name: "browser_press_key",
    description: "Press a key on the keyboard",
    inputSchema: zodToJsonSchema(PressKeyArgs) as Record<string, unknown>,
  },
  handle: async (context, params) => {
    const { key } = PressKeyArgs.parse(params);
    await context.sendSocketMessage("browser_press_key", { key });
    return textResult(`Pressed key ${key}`);
  },
};
