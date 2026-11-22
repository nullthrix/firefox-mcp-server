export const MESSAGE_RESPONSE_TYPE = "messageResponse";
export const DEFAULT_WS_PORT = 9009;
export const PROTOCOL_VERSION = "1";
export type WireRequest = { id: string; type: string; payload: unknown; };
export type WireResponse = { id: string; type: typeof MESSAGE_RESPONSE_TYPE; payload: { requestId: string; result?: unknown; error?: string; version?: string; protocol?: string; }; };
export type HelloPayload = { version: string; protocol: string; ua?: string };
export function isWireResponse(v: unknown): v is WireResponse {
  if (typeof v !== "object" || v===null) return false;
  const r=v as Record<string,unknown>;
  return r.type===MESSAGE_RESPONSE_TYPE && typeof r.id==="string" && typeof r.payload==="object" && r.payload!==null && typeof (r.payload as Record<string,unknown>).requestId==="string";
}
export const TYPE_ALIASES: Record<string,string> = { getUrl:"get_url", get_url:"getUrl", getTitle:"get_title", get_title:"getTitle", browser_snapshot:"snapshot", snapshot:"browser_snapshot" };
export function canonical(t:string){ return TYPE_ALIASES[t]||t; }
export function isCompatibleHello(p:unknown){ if(!p||typeof p!=="object") return {ok:true} as const; const {protocol}=p as Record<string,unknown>; if(protocol && protocol!==PROTOCOL_VERSION) return {ok:true,warn:`protocol ${String(protocol)} vs server ${PROTOCOL_VERSION} — update both`} as const; return {ok:true} as const; }
function generateId():string{ if(typeof globalThis.crypto?.randomUUID==="function") return globalThis.crypto.randomUUID(); return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`; }
export { generateId };
