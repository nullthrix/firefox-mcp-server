#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { program } from "commander";

import { DEFAULT_WS_PORT } from "@/context.js";
import type { Resource } from "@/resources/resource.js";
import { createServerWithTools } from "@/server.js";
import * as common from "@/tools/common.js";
import * as custom from "@/tools/custom.js";
import * as snapshotTools from "@/tools/snapshot.js";
import type { Tool } from "@/tools/tool.js";

const NAME = "Firefox MCP";
const VERSION = "0.1.0";

function setupExitWatchdog(server: Server): void {
  process.stdin.on("close", async () => {
    setTimeout(() => process.exit(0), 15_000);
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

const tools: Tool[] = [
  common.navigate(true),
  common.goBack(true),
  common.goForward(true),
  snapshotTools.snapshot,
  snapshotTools.click,
  snapshotTools.hover,
  snapshotTools.type,
  snapshotTools.selectOption,
  snapshotTools.drag,
  common.pressKey,
  common.wait,
  custom.getConsoleLogs,
  custom.screenshot,
];

const resources: Resource[] = [];

program
  .name("firefox-mcp")
  .description(
    "MCP server that drives your real, logged-in Firefox through a WebExtension bridge.",
  )
  .version(`Version ${VERSION}`)
  .option(
    "-p, --port <port>",
    `WebSocket port the extension connects back to (default: ${DEFAULT_WS_PORT})`,
    (v) => Number(v),
    DEFAULT_WS_PORT,
  );

program.action(async () => {
  const opts = program.opts<{ port: number }>();
  const server = await createServerWithTools({
    name: NAME,
    version: VERSION,
    tools,
    resources,
    port: opts.port,
  });
  setupExitWatchdog(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[firefox-mcp] MCP server ready (pid ${process.pid})`);
});

program.parse(process.argv);
