import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import { captureAriaSnapshot } from "@/utils/aria-snapshot.js";
import type { Tool } from "./tool.js";

// ── Shared element schema ──────────────────────────────────────────────────────

const ElementSchema = z.object({
  element: z
    .string()
    .describe("Human-readable element description used to obtain permission to interact with the element"),
  ref: z.string().describe("Exact target element reference from the page snapshot"),
});

// ── snapshot ──────────────────────────────────────────────────────────────────

export const snapshot: Tool = {
  schema: {
    name: "browser_snapshot",
    description:
      "Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with.",
    inputSchema: zodToJsonSchema(z.object({})) as Record<string, unknown>,
  },
  handle: async (context) => captureAriaSnapshot(context),
};

// ── click ──────────────────────────────────────────────────────────────────────

export const click: Tool = {
  schema: {
    name: "browser_click",
    description: "Perform click on a web page",
    inputSchema: zodToJsonSchema(ElementSchema) as Record<string, unknown>,
  },
  handle: async (context, params) => {
    const { element, ref } = ElementSchema.parse(params);
    await context.sendSocketMessage("browser_click", { element, ref });
    const snap = await captureAriaSnapshot(context);
    return {
      content: [{ type: "text", text: `Clicked "${element}"` }, ...snap.content],
    };
  },
};

// ── hover ──────────────────────────────────────────────────────────────────────

export const hover: Tool = {
  schema: {
    name: "browser_hover",
    description: "Hover over element on page",
    inputSchema: zodToJsonSchema(ElementSchema) as Record<string, unknown>,
  },
  handle: async (context, params) => {
    const { element, ref } = ElementSchema.parse(params);
    await context.sendSocketMessage("browser_hover", { element, ref });
    const snap = await captureAriaSnapshot(context);
    return {
      content: [{ type: "text", text: `Hovered over "${element}"` }, ...snap.content],
    };
  },
};

// ── type ──────────────────────────────────────────────────────────────────────

const TypeArgs = ElementSchema.extend({
  text: z.string().describe("Text to type into the element"),
  submit: z.boolean().describe("Whether to submit entered text (press Enter after)").optional(),
});

export const type: Tool = {
  schema: {
    name: "browser_type",
    description: "Type text into editable element",
    inputSchema: zodToJsonSchema(TypeArgs) as Record<string, unknown>,
  },
  handle: async (context, params) => {
    const { element, ref, text, submit } = TypeArgs.parse(params);
    await context.sendSocketMessage("browser_type", { element, ref, text, submit: submit ?? false });
    const snap = await captureAriaSnapshot(context);
    return {
      content: [{ type: "text", text: `Typed "${text}" into "${element}"` }, ...snap.content],
    };
  },
};

// ── selectOption ──────────────────────────────────────────────────────────────

const SelectOptionArgs = ElementSchema.extend({
  values: z
    .array(z.string())
    .describe("Array of values to select in the dropdown. This can be a single value or multiple values."),
});

export const selectOption: Tool = {
  schema: {
    name: "browser_select_option",
    description: "Select an option in a dropdown",
    inputSchema: zodToJsonSchema(SelectOptionArgs) as Record<string, unknown>,
  },
  handle: async (context, params) => {
    const { element, ref, values } = SelectOptionArgs.parse(params);
    await context.sendSocketMessage("browser_select_option", { element, ref, values });
    const snap = await captureAriaSnapshot(context);
    return {
      content: [{ type: "text", text: `Selected option in "${element}"` }, ...snap.content],
    };
  },
};

// ── drag ──────────────────────────────────────────────────────────────────────

const DragArgs = z.object({
  startElement: z
    .string()
    .describe("Human-readable source element description used to obtain the permission to interact with the element"),
  startRef: z.string().describe("Exact source element reference from the page snapshot"),
  endElement: z
    .string()
    .describe("Human-readable target element description used to obtain the permission to interact with the element"),
  endRef: z.string().describe("Exact target element reference from the page snapshot"),
});

export const drag: Tool = {
  schema: {
    name: "browser_drag",
    description: "Perform drag and drop between two elements",
    inputSchema: zodToJsonSchema(DragArgs) as Record<string, unknown>,
  },
  handle: async (context, params) => {
    const { startElement, startRef, endElement, endRef } = DragArgs.parse(params);
    await context.sendSocketMessage("browser_drag", { startElement, startRef, endElement, endRef });
    const snap = await captureAriaSnapshot(context);
    return {
      content: [
        { type: "text", text: `Dragged "${startElement}" to "${endElement}"` },
        ...snap.content,
      ],
    };
  },
};
