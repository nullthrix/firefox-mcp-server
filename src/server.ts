import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { Context } from "@/context.js";
import type { Resource } from "@/resources/resource.js";
import type { Tool } from "@/tools/tool.js";
import { createWebSocketServer } from "@/ws.js";

type Options = {
  name: string;
  version: string;
  tools: Tool[];
  resources: Resource[];
  port?: number;
};

export async function createServerWithTools(options: Options): Promise<Server> {
  const { name, version, tools, resources, port } = options;
  const context = new Context();

  const server = new Server(
    { name, version },
    { capabilities: { tools: {}, resources: {} } },
  );

  const wss = await createWebSocketServer(port);
  wss.on("connection", (websocket) => {
    if (context.hasWs()) {
      context.ws.close();
    }
    context.ws = websocket;
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => t.schema),
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map((r) => r.schema),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.schema.name === request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Tool "${request.params.name}" not found` }],
        isError: true,
      };
    }
    try {
      return await tool.handle(context, request.params.arguments as Record<string, unknown>);
    } catch (error) {
      return {
        content: [{ type: "text", text: String(error) }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find((r) => r.schema.uri === request.params.uri);
    if (!resource) return { contents: [] };
    const contents = await resource.read(context, request.params.uri);
    return { contents };
  });

  // Override close to also shut down the WebSocket server and context.
  const originalClose = server.close.bind(server);
  server.close = async () => {
    await originalClose();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await context.close();
  };

  return server;
}
