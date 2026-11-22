// 도구 계층 테스트: 경로 허용 목록, 명령 주입, 마스킹, 포트 검증, 샌드박스 격리
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertAllowedPath, run } from "../src/safe.js";
import { mask } from "../src/mask.js";
import { gitSummary } from "../src/tools/git.js";
import { portCheck } from "../src/tools/port.js";
import { runInSandbox } from "../src/tools/sandbox.js";

const root = mkdtempSync(path.join(tmpdir(), "envscout-"));
process.env.ENVSCOUT_ROOTS = root;
const outside = mkdtempSync(path.join(tmpdir(), "envscout-out-"));

describe("경로 허용 목록", () => {
  it("허용 루트 안은 통과", () => {
    expect(assertAllowedPath(root)).toBeTruthy();
  });
  it("루트 밖 경로는 거부", () => {
    expect(() => assertAllowedPath(outside)).toThrow("허용 목록 밖");
  });
  it(".. 우회는 거부", () => {
    expect(() => assertAllowedPath(path.join(root, "..", path.basename(outside)))).toThrow("허용 목록 밖");
  });
});

describe("명령 주입", () => {
  it("; 가 포함된 인자는 별도 명령으로 실행되지 않는다", async () => {
    const r = await run("node", ["-e", "console.log(process.argv[1])", "a; echo INJECTED"]);
    expect(r.stdout.trim()).toBe("a; echo INJECTED");
  });
});

describe("마스킹", () => {
  it("키와 토큰을 가린다", () => {
    const s = mask("ANTHROPIC_API_KEY=sk-ant-abcdefgh12345 token ghp_abcdefghijklmnopqrstuv Bearer abc.def-123456");
    expect(s).not.toMatch(/sk-ant-abcdefgh/);
    expect(s).not.toMatch(/ghp_abcdef/);
    expect(s).not.toMatch(/abc\.def-123456/);
    expect(s).toContain("ANTHROPIC_API_KEY=***");
    expect(mask("gsk_abcdefghijklmnopqrstuvwx postgresql://u:pw@ep.neon.tech/db")).not.toMatch(/gsk_abc|pw@/);
  });
});

describe("git_summary", () => {
  beforeAll(() => {
    const g = (...a: string[]) => spawnSync("git", a, { cwd: root });
    g("init", "-q");
    g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init");
    mkdirSync(path.join(root, "x"));
    writeFileSync(path.join(root, "x", "a.txt"), "hi");
  });
  it("커밋 안 한 변경을 센다", async () => {
    const r = await gitSummary(root);
    expect(r.changedCount).toBe(1);
    expect(r.lastCommit).toContain("init");
  });
});

describe("port_check", () => {
  it("범위 밖 포트는 거부", async () => {
    await expect(portCheck(70000)).rejects.toThrow();
    await expect(portCheck(1.5)).rejects.toThrow();
  });
  it("닫힌 포트는 open=false", async () => {
    expect((await portCheck(1)).open).toBe(false);
  });
});

// Docker 엔진이 없으면 샌드박스 테스트는 건너뛴다
const dockerUp = spawnSync("docker", ["info"], { timeout: 8000 }).status === 0;
describe.skipIf(!dockerUp)("샌드박스 격리 (Docker 필요)", () => {
  const t = 60_000;
  it("정상 코드 실행", async () => {
    const r = await runInSandbox("console.log(1+1)");
    expect(r.stdout.trim()).toBe("2");
  }, t);
  it("외부 네트워크 차단", async () => {
    const r = await runInSandbox("fetch('https://example.com').then(()=>console.log('REACHED')).catch(()=>console.log('BLOCKED'))");
    expect(r.stdout).toContain("BLOCKED");
  }, t);
  it("루트 파일시스템 쓰기 차단", async () => {
    const r = await runInSandbox("try{require('fs').writeFileSync('/etc/x','1');console.log('WROTE')}catch{console.log('DENIED')}");
    expect(r.stdout).toContain("DENIED");
  }, t);
  it("무한 루프는 시간 초과로 종료", async () => {
    const r = await runInSandbox("while(true){}");
    expect(r.timedOut).toBe(true);
  }, t);
});
