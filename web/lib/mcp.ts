// MCP 서버를 자식 프로세스(stdio)로 띄워 한 번만 연결하고 재사용한다
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const g = globalThis as unknown as { __mcp?: Promise<Client> };

export function getMcp(): Promise<Client> {
  g.__mcp ??= (async () => {
    const entry = process.env.ENVSCOUT_MCP ?? path.resolve(process.cwd(), "../mcp-server/dist/index.js");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      // docker·git를 찾으려면 PATH가 필요해서 환경변수를 그대로 넘긴다
      env: process.env as Record<string, string>,
    });
    const client = new Client({ name: "envscout-web", version: "0.1.0" });
    await client.connect(transport);
    return client;
  })().catch((e) => {
    g.__mcp = undefined; // 실패한 연결은 캐시하지 않는다
    throw e;
  });
  return g.__mcp;
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  const client = await getMcp();
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as { type: string; text?: string }[];
  return { ok: !r.isError, text: content.map((c) => c.text ?? "").join("\n") };
}
