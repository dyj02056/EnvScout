// MCP 서버 진입점: 도구 6개를 stdio로 노출한다
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mask, maskDeep } from "@envscout/shared";
import { gitSummary } from "./tools/git.js";
import { dockerPs } from "./tools/docker.js";
import { portCheck } from "./tools/port.js";
import { npmOutdated } from "./tools/npm.js";
import { runInSandbox } from "./tools/sandbox.js";
import { listRepos } from "./tools/repos.js";

const server = new McpServer({ name: "envscout", version: "0.2.0" });

// 모든 도구가 같은 방식으로 결과/오류를 감싼다. 객체 단위로 마스킹해서 JSON 구조가 깨지지 않게 한다.
const wrap = (fn: () => Promise<unknown>) => async () => {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(maskDeep(await fn())) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text" as const, text: mask((e as Error).message) }] };
  }
};

const pathArg = { path: z.string().min(1).describe("허용 목록 안의 저장소/프로젝트 경로") };

server.registerTool("list_repos", { description: "허용 루트 아래 git 저장소 목록과 저장소별 커밋 안 한 변경 수 (읽기 전용)", inputSchema: { depth: z.number().int().min(0).max(4).optional().describe("루트에서 몇 단계 아래까지 찾을지 (기본 2)") } }, ({ depth }) => wrap(() => listRepos(depth ?? 2))());
server.registerTool("git_summary", { description: "저장소 하나의 브랜치와 커밋 안 한 변경 요약 (읽기 전용)", inputSchema: pathArg }, ({ path }) => wrap(() => gitSummary(path))());
server.registerTool("docker_ps", { description: "실행 중인 컨테이너와 포트 목록 (읽기 전용)", inputSchema: {} }, () => wrap(dockerPs)());
server.registerTool("port_check", { description: "로컬 포트가 열려 있는지 확인 (IPv4·IPv6)", inputSchema: { port: z.number().int().min(1).max(65535) } }, ({ port }) => wrap(() => portCheck(port))());
server.registerTool("npm_outdated", { description: "오래된 npm 의존성 목록 (읽기 전용)", inputSchema: pathArg }, ({ path }) => wrap(() => npmOutdated(path))());
server.registerTool("run_in_sandbox", { description: "Node 코드를 네트워크 차단된 Docker 샌드박스에서 실행", inputSchema: { code: z.string().min(1) } }, ({ code }) => wrap(() => runInSandbox(code))());

await server.connect(new StdioServerTransport());
