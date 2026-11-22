// MCP 서버를 자식 프로세스(stdio)로 띄워 연결을 재사용한다. 프로세스가 죽으면 다음 호출 때 다시 띄운다.
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const g = globalThis as unknown as { __mcp?: Promise<Client> };

// 자식 프로세스에는 도구 실행에 필요한 값만 넘긴다. GROQ_API_KEY·DATABASE_URL 같은 비밀값은 넘기지 않는다.
const ENV_ALLOW = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES.*|TEMP|TMP|TMPDIR|LANG|LC_.*|DOCKER_.*|ENVSCOUT_.*|XDG_.*)$/i;

export function childEnv(src: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) if (v !== undefined && ENV_ALLOW.test(k)) out[k] = v;
  return out;
}

function reset(p: Promise<Client>) {
  if (g.__mcp === p) g.__mcp = undefined;
}

export function getMcp(): Promise<Client> {
  if (g.__mcp) return g.__mcp;
  const p: Promise<Client> = (async () => {
    const entry = process.env.ENVSCOUT_MCP ?? path.resolve(process.cwd(), "../mcp-server/dist/index.js");
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: childEnv() });
    const client = new Client({ name: "envscout-web", version: "0.1.0" });
    client.onclose = () => reset(p); // 자식 프로세스가 죽으면 캐시를 비워 다음 요청에서 다시 연결
    await client.connect(transport);
    return client;
  })();
  g.__mcp = p;
  p.catch(() => reset(p)); // 실패한 연결은 캐시하지 않는다
  return p;
}

/** 연결 자체가 실패한 오류. 도구가 돌려준 오류(isError)와 구분해서 재시도 여부를 정한다. */
export class TransportError extends Error {}

export async function callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  let r;
  try {
    const client = await getMcp();
    r = await client.callTool({ name, arguments: args });
  } catch (e) {
    const msg = (e as Error).message;
    // MCP 프로토콜 오류(잘못된 인자 등)는 도구 오류로 돌려준다
    if (/MCP error -32602|Invalid arguments|validation/i.test(msg)) return { ok: false, text: msg };
    const cur = g.__mcp;
    if (cur) {
      const c = await cur.catch(() => null);
      await c?.close().catch(() => {});
      reset(cur);
    }
    throw new TransportError(`MCP 서버 연결 오류: ${msg}`);
  }
  const content = r.content as { type: string; text?: string }[];
  return { ok: !r.isError, text: content.map((c) => c.text ?? "").join("\n") };
}
