import type { WebSocket } from "ws";
import {
  DEFAULT_WS_PORT,
  generateId,
  isWireResponse,
  MESSAGE_RESPONSE_TYPE,
  type WireRequest,
} from "@/protocol.js";

export const NO_CONNECTION_MESSAGE =
  "No connection to browser extension. In order to proceed, you must first connect a tab by " +
  "clicking the Firefox MCP extension icon in the browser toolbar and clicking the 'Connect' button.";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class Context {
  private _ws: WebSocket | undefined;
  private readonly pending = new Map<string, Pending>();

  get ws(): WebSocket {
    if (!this._ws) throw new Error(NO_CONNECTION_MESSAGE);
    return this._ws;
  }

  set ws(ws: WebSocket) {
    this._ws = ws;
    ws.on("message", (data: Buffer | string) => this._onMessage(String(data)));
    ws.on("close", () => {
      if (this._ws === ws) this._ws = undefined;
      this._rejectAll("The Firefox extension disconnected.");
    });
    ws.on("error", (err: Error) => console.error("[firefox-mcp] socket error:", err.message));
  }

  hasWs(): boolean {
    return !!this._ws;
  }

  private _onMessage(raw: string): void {
    let msg: unknown;
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

    if (msg.payload.error) {
      entry.reject(new Error(msg.payload.error));
    } else {
      entry.resolve(msg.payload.result);
    }
  }

  private _rejectAll(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }

  async sendSocketMessage<T = unknown>(
    type: string,
    payload: unknown,
    options: { timeoutMs?: number } = { timeoutMs: 30_000 },
  ): Promise<T> {
    const ws = this.ws; // throws NO_CONNECTION_MESSAGE when disconnected
    const id = generateId();
    const frame: WireRequest = { id, type, payload: payload ?? {} };

    return new Promise<T>((resolve, reject) => {
      const { timeoutMs = 30_000 } = options;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${type}".`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      ws.send(JSON.stringify(frame), (err?: Error) => {
        if (!err) return;
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        reject(err);
      });
    });
  }

  async close(): Promise<void> {
    this._rejectAll("Server shutting down.");
    if (!this._ws) return;
    const ws = this._ws;
    this._ws = undefined;
    await new Promise<void>((resolve) => {
      ws.once("close", resolve);
      ws.close();
      setTimeout(resolve, 500);
    });
  }
}

export { DEFAULT_WS_PORT };
