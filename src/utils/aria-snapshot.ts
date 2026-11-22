import type { Context } from "@/context.js";
import type { ToolResult } from "@/tools/tool.js";

export async function captureAriaSnapshot(
  context: Context,
  status: string = "",
): Promise<ToolResult> {
  const url = await context.sendSocketMessage<string>("getUrl", undefined);
  const title = await context.sendSocketMessage<string>("getTitle", undefined);
  const snapshot = await context.sendSocketMessage<string>("browser_snapshot", {});
  return {
    content: [
      {
        type: "text",
        text:
          `${status ? `${status}\n` : ""}` +
          `\n- Page URL: ${url}\n- Page Title: ${title}\n- Page Snapshot\n\`\`\`yaml\n${snapshot}\n\`\`\`\n`,
      },
    ],
  };
}
