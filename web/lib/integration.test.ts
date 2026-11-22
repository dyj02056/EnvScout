// 통합 테스트: 빌드된 MCP 서버를 실제로 띄워 도구 목록과 호출을 확인한다(LLM 없이).
// mcp-server를 먼저 빌드해야 한다(npm run build -w envscout-mcp). 빌드가 없으면 건너뛴다.
import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { getMcp, callTool } from "./mcp";

const entry = path.resolve(__dirname, "../../mcp-server/dist/index.js");
process.env.ENVSCOUT_MCP = entry;
process.env.ENVSCOUT_ROOTS = path.resolve(__dirname, "../..");

describe.skipIf(!existsSync(entry))("MCP 서버 통합", () => {
  afterAll(async () => {
    await (await getMcp()).close();
  });

  it("도구 6개를 노출한다", async () => {
    const { tools } = await (await getMcp()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["docker_ps", "git_summary", "list_repos", "npm_outdated", "port_check", "run_in_sandbox"]);
  }, 30_000);

  it("port_check를 호출하면 JSON 결과가 온다", async () => {
    const r = await callTool("port_check", { port: 1 });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ port: 1, open: false });
  }, 30_000);

  it("허용 루트 밖 경로는 도구 오류로 돌아온다", async () => {
    const r = await callTool("git_summary", { path: path.parse(process.cwd()).root });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("허용 목록 밖");
  }, 30_000);

  it("list_repos가 이 저장소를 찾는다", async () => {
    const r = await callTool("list_repos", { depth: 0 });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.text).count).toBe(1);
  }, 30_000);
});
