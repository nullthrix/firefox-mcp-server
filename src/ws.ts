import { WebSocketServer } from "ws";
import { DEFAULT_WS_PORT } from "@/context.js";
import { isPortInUse, killProcessOnPort, wait } from "@/utils/port.js";

export async function createWebSocketServer(
  port: number = DEFAULT_WS_PORT,
): Promise<WebSocketServer> {
  killProcessOnPort(port);
  while (await isPortInUse(port)) {
    await wait(100);
  }
  const wss = new WebSocketServer({ port, host: "127.0.0.1" });
  wss.on("listening", () => {
    console.error(`[firefox-mcp] WebSocket bridge listening on ws://127.0.0.1:${port}`);
  });
  return wss;
}
