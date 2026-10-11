/**
 * Wire protocol between the MCP server and the Firefox extension.
 *
 * The server is the WebSocket **server** (listens on loopback 9009).
 * The extension is the WebSocket **client** (connects from background.js).
 *
 * All frames are JSON.
 *
 * Server → Extension:
 *   { id: string, type: string, payload: unknown }
 *
 * Extension → Server (response):
 *   { id: string, type: "messageResponse", payload: { requestId: string, result?: unknown, error?: string } }
 */

export const MESSAGE_RESPONSE_TYPE = "messageResponse";
export const DEFAULT_WS_PORT = 9009;

export type WireRequest = {
  id: string;
  type: string;
  payload: unknown;
};

export type WireResponse = {
  id: string;
  type: typeof MESSAGE_RESPONSE_TYPE;
  payload: {
    requestId: string;
    result?: unknown;
    error?: string;
  };
};

export function isWireResponse(value: unknown): value is WireResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === MESSAGE_RESPONSE_TYPE &&
    typeof v.id === "string" &&
    typeof v.payload === "object" &&
    v.payload !== null &&
    typeof (v.payload as Record<string, unknown>).requestId === "string"
  );
}

function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export { generateId };
