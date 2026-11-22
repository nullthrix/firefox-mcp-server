import type { WebSocket } from "ws";
import { DEFAULT_WS_PORT, generateId, isWireResponse, isCompatibleHello, type WireRequest } from "@/protocol.js";
export const NO_CONNECTION_MESSAGE = "No connection to Firefox. Click the toolbar icon in the tab you want (badge ON). If version mismatch, run: git pull + npm run build and reinstall AMO addon.";
type Pending={resolve:(v:unknown)=>void; reject:(e:Error)=>void; timer:ReturnType<typeof setTimeout>};
export class Context {
  private _ws:WebSocket|undefined; private pending=new Map<string,Pending>();
  get ws():WebSocket{ if(!this._ws) throw new Error(NO_CONNECTION_MESSAGE); return this._ws; }
  set ws(ws:WebSocket){
    this._ws=ws;
    ws.on("message",(d:Buffer|string)=>this._onMessage(String(d)));
    ws.on("close",()=>{ if(this._ws===ws) this._ws=undefined; this._rejectAll("Extension disconnected — toggle OFF→ON in Firefox."); });
    ws.on("error",(e:Error)=>console.error("[firefox-mcp] socket:",e.message));
  }
  hasWs(){ return !!this._ws; }
  private _onMessage(raw:string){
    let m:unknown; try{m=JSON.parse(raw);}catch{return;}
    if(!isWireResponse(m)){
      if(typeof m==="object"&&m!==null&&(m as Record<string,unknown>).type==="hello"){
        const c=isCompatibleHello((m as Record<string,unknown>).payload);
        if((c as Record<string,unknown>).warn) console.warn("[firefox-mcp]",(c as Record<string,unknown>).warn);
        return;
      }
      return;
    }
    const e=this.pending.get(m.payload.requestId); if(!e) return;
    this.pending.delete(m.payload.requestId); clearTimeout(e.timer);
    if(m.payload.error) e.reject(new Error(m.payload.error)); else e.resolve(m.payload.result);
  }
  private _rejectAll(r:string){ for(const[,e] of this.pending){ clearTimeout(e.timer); e.reject(new Error(r)); } this.pending.clear(); }
  async sendSocketMessage<T>(type:string,payload:unknown,opts:{timeoutMs?:number}={timeoutMs:30000}):Promise<T>{
    const ws=this.ws; const id=generateId(); const f:WireRequest={id,type,payload:payload??{}};
    return new Promise<T>((ok,err)=>{
      const t=setTimeout(()=>{this.pending.delete(id); err(new Error(`Timeout ${opts.timeoutMs??30000}ms "${type}". ${NO_CONNECTION_MESSAGE}`));},opts.timeoutMs??30000);
      this.pending.set(id,{resolve:ok as (v:unknown)=>void,reject:err,timer:t});
      ws.send(JSON.stringify(f),(e?:Error)=>{ if(e){const p=this.pending.get(id); if(p){this.pending.delete(id); clearTimeout(p.timer); err(e);}}});
    });
  }
  async close(){ this._rejectAll("Server shutting down."); if(!this._ws) return; const w=this._ws; this._ws=undefined; await new Promise<void>(r=>{w.once("close",r); w.close(); setTimeout(r,500);}); }
}
export { DEFAULT_WS_PORT };
