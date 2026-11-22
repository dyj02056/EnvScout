// 도구 계층 테스트: 경로 허용 목록, 명령 주입, 마스킹, 도구별 파싱, 포트 검증, 샌드박스 격리
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertAllowedPath, run } from "../src/safe.js";
import { gitSummary, parseStatus } from "../src/tools/git.js";
import { portCheck } from "../src/tools/port.js";
import { runInSandbox } from "../src/tools/sandbox.js";
import { npmOutdated, parseOutdated } from "../src/tools/npm.js";
import { parseDockerPs } from "../src/tools/docker.js";
import { findRepos } from "../src/tools/repos.js";

const root = mkdtempSync(path.join(tmpdir(), "envscout-"));
process.env.ENVSCOUT_ROOTS = root;
const outside = mkdtempSync(path.join(tmpdir(), "envscout-out-"));
const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd });
const initRepo = (cwd: string) => {
  git(cwd, "init", "-q");
  git(cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init");
};

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

describe("명령 실행", () => {
  it("; 가 포함된 인자는 별도 명령으로 실행되지 않는다", async () => {
    const r = await run("node", ["-e", "console.log(process.argv[1])", "a; echo INJECTED"]);
    expect(r.stdout.trim()).toBe("a; echo INJECTED");
  });
  it("출력의 비밀값을 가린다", async () => {
    const r = await run("node", ["-e", "console.log('GROQ_API_KEY=gsk_abcdefghijklmnopqrstuvwx')"]);
    expect(r.stdout).not.toContain("gsk_abc");
  });
  it.runIf(process.platform === "win32")("Windows .cmd를 쉘 없이 실행하면 동기 예외 대신 거부된 Promise가 된다", async () => {
    await expect(run("npm.cmd", ["-v"])).rejects.toThrow(/실행 실패|찾을 수 없습니다/);
  });
});

describe("git_summary", () => {
  beforeAll(() => {
    initRepo(root);
    mkdirSync(path.join(root, "x"));
    writeFileSync(path.join(root, "x", "a.txt"), "hi");
    writeFileSync(path.join(root, "한글.txt"), "hi");
  });
  it("커밋 안 한 변경을 세고 한글 파일명을 그대로 보여 준다", async () => {
    const r = await gitSummary(root);
    expect(r.changedCount).toBe(2);
    expect(r.changed.join("\n")).toContain("한글.txt");
    expect(r.lastCommit).toContain("init");
  });
  it("-z 출력의 이름 바꾸기 항목을 한 줄로 합친다", () => {
    const r = parseStatus("## main...origin/main\0R  new.ts\0old.ts\0 M a.ts\0");
    expect(r.branch).toBe("main...origin/main");
    expect(r.files).toEqual(["R  new.ts <- old.ts", " M a.ts"]);
  });
});

describe("list_repos", () => {
  it("루트 아래 저장소를 찾고 node_modules와 저장소 내부는 건너뛴다", () => {
    const base = mkdtempSync(path.join(tmpdir(), "envscout-repos-"));
    for (const d of ["a", "group/b", "node_modules/c", "a/inner"]) mkdirSync(path.join(base, d), { recursive: true });
    initRepo(path.join(base, "a"));
    initRepo(path.join(base, "group/b"));
    initRepo(path.join(base, "node_modules/c"));
    initRepo(path.join(base, "a/inner"));
    const found = findRepos(base, 2).map((p) => path.relative(base, p).replaceAll("\\", "/")).sort();
    expect(found).toEqual(["a", "group/b"]);
    expect(findRepos(base, 1).map((p) => path.basename(p))).toEqual(["a"]);
  });
});

describe("npm_outdated", () => {
  it("오래된 패키지가 있으면(exit 1) 목록으로 돌려준다", () => {
    const r = parseOutdated(JSON.stringify({ zod: { current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" } }), "", 1);
    expect(r).toEqual({ count: 1, packages: [{ name: "zod", current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" }] });
  });
  it("출력 없이 실패하면 0개로 숨기지 않고 오류를 낸다", () => {
    expect(() => parseOutdated("", "npm error code ENOLOCK\nnpm error missing lockfile", 1)).toThrow("npm outdated 실패");
    expect(() => parseOutdated(JSON.stringify({ error: { code: "E1", summary: "bad" } }), "", 1)).toThrow("bad");
  });
  it("실제 npm을 쉘 없이 실행한다 (Windows 포함)", async () => {
    const proj = path.join(root, "proj");
    mkdirSync(proj);
    writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "p", version: "1.0.0" }));
    expect(await npmOutdated(proj)).toEqual({ count: 0, packages: [] });
  }, 60_000);
  it("package.json이 없으면 안내한다", async () => {
    await expect(npmOutdated(root)).rejects.toThrow("package.json");
  });
});

describe("docker_ps 파싱", () => {
  it("한 줄에 하나인 JSON을 읽는다", () => {
    const out = `${JSON.stringify({ Names: "db", Image: "postgres", Ports: "5432/tcp", Status: "Up" })}\n\n`;
    expect(parseDockerPs(out)).toEqual({ count: 1, containers: [{ name: "db", image: "postgres", ports: "5432/tcp", status: "Up" }] });
  });
});

describe("port_check", () => {
  let v6: net.Server | null = null;
  let v6Port = 0;
  beforeAll(async () => {
    v6 = net.createServer();
    await new Promise<void>((resolve) => {
      v6!.once("error", () => { v6 = null; resolve(); }); // IPv6가 없는 환경
      v6!.listen(0, "::1", () => { v6Port = (v6!.address() as net.AddressInfo).port; resolve(); });
    });
  });
  afterAll(() => { v6?.close(); });

  it("범위 밖 포트는 거부", async () => {
    await expect(portCheck(70000)).rejects.toThrow();
    await expect(portCheck(1.5)).rejects.toThrow();
  });
  it("닫힌 포트는 open=false", async () => {
    expect((await portCheck(1)).open).toBe(false);
  });
  it("::1에서만 열린 포트도 open=true", async (ctx) => {
    if (!v6) ctx.skip();
    const r = await portCheck(v6Port);
    expect(r).toMatchObject({ open: true, ipv6: true });
  });
});

// 리눅스 컨테이너를 돌릴 수 있는 Docker 엔진이 없으면 샌드박스 테스트는 건너뛴다(Windows CI는 Windows 컨테이너 모드)
const dockerLinux = spawnSync("docker", ["info", "--format", "{{.OSType}}"], { timeout: 8000, encoding: "utf8" }).stdout?.trim() === "linux";
describe.skipIf(!dockerLinux)("샌드박스 격리 (Docker 필요)", () => {
  const t = 180_000; // 첫 실행에서 이미지를 받을 수 있다
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
