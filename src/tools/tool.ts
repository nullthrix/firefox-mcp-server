import type { ImageContent, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { Context } from "@/context.js";

export type ToolSchema = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolResult = {
  content: (ImageContent | TextContent)[];
  isError?: boolean;
};

export type Tool = {
  schema: ToolSchema;
  handle: (context: Context, params?: Record<string, unknown>) => Promise<ToolResult>;
};

export type ToolFactory = (snapshot: boolean) => Tool;

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function requireString(params: Record<string, unknown> | undefined, name: string): string {
  const v = params?.[name];
  if (typeof v !== "string" || v.length === 0)
    throw new Error(`Missing required argument "${name}".`);
  return v;
}

export function optionalString(
  params: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const v = params?.[name];
  return typeof v === "string" ? v : undefined;
}
