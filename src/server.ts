import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Context } from "@/context.js";
import type { Resource } from "@/resources/resource.js";
import type { Tool } from "@/tools/tool.js";
import { createWebSocketServer } from "@/ws.js";
export async function createServerWithTools(o:{name:string;version:string;tools:Tool[];resources:Resource[];port?:number}):Promise<Server>{
  const {name,version,tools,resources,port}=o; const ctx=new Context();
  const server=new Server({name,version},{capabilities:{tools:{},resources:{}}});
  const wss=await createWebSocketServer(port);
  wss.on("connection",(ws)=>{ try{ if(ctx.hasWs()) ctx.ws.close(); }catch{} ctx.ws=ws; console.error(`[firefox-mcp] connected (server ${version}) — any client version accepted`); });
  server.setRequestHandler(ListToolsRequestSchema, async()=>({tools:tools.map(t=>t.schema)}));
  server.setRequestHandler(ListResourcesRequestSchema, async()=>({resources:resources.map(r=>r.schema)}));
  server.setRequestHandler(CallToolRequestSchema, async(req)=>{
    const t=tools.find(x=>x.schema.name===req.params.name);
    if(!t) return {content:[{type:"text",text:`Tool "${req.params.name}" not found. Update: npm i -g ff-browser-mcp-bridge@latest + reinstall addon`}],isError:true};
    try{ return await t.handle(ctx, req.params.arguments as Record<string,unknown>); } catch(e){ return {content:[{type:"text",text:String(e)}],isError:true}; }
  });
  server.setRequestHandler(ReadResourceRequestSchema, async(req)=>{
    const r=resources.find(x=>x.schema.uri===req.params.uri); if(!r) return {contents:[]}; return {contents: await r.read(ctx, req.params.uri)};
  });
  const orig=server.close.bind(server); server.close=async()=>{ await orig(); await new Promise<void>(r=>wss.close(()=>r())); await ctx.close(); };
  return server;
}
