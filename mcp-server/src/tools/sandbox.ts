// run_in_sandbox: 코드는 Docker 컨테이너 안에서만 실행한다
import { randomUUID } from "node:crypto";
import { run } from "../safe.js";

const IMAGE = process.env.ENVSCOUT_IMAGE ?? "node:22-alpine";
const TIMEOUT_MS = 10_000;

// 코드는 마운트하지 않고 stdin으로 넘긴다. 호스트 파일이 컨테이너에 노출되지 않는다.
// shortcut: 언어는 node만 지원, python은 이미지와 명령만 추가하면 됨
export function sandboxArgs(name: string): string[] {
  return [
    "run", "--rm", "-i", "--name", name,
    "--network", "none",
    "--memory", "256m", "--cpus", "0.5", "--pids-limit", "64",
    "--read-only", "--tmpfs", "/tmp:size=16m",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--user", "65534",
    IMAGE, "node", "-",
  ];
}

export async function runInSandbox(code: string) {
  if (code.length > 20_000) throw new Error("코드가 너무 깁니다(20KB 제한)");
  const name = `envscout-${randomUUID().slice(0, 8)}`;
  const started = Date.now();
  // docker CLI에 SIGTERM을 보내면 컨테이너의 PID 1(node)이 무시해서 끝나지 않는다(리눅스).
  // 그래서 제한 시간이 되면 컨테이너를 이름으로 직접 kill 한다.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void run("docker", ["kill", name], { timeout: 5000 }).catch(() => {});
  }, TIMEOUT_MS);
  try {
    // run()의 자체 타임아웃은 kill이 실패했을 때를 위한 안전망
    const r = await run("docker", sandboxArgs(name), { input: code, timeout: TIMEOUT_MS + 15_000 });
    if (timedOut) {
      return { exitCode: 124, stdout: r.stdout.slice(0, 32_768), stderr: "10초 제한을 넘어 종료했습니다", ms: Date.now() - started, timedOut: true };
    }
    if (r.code !== 0 && /Cannot connect|error during connect|pipe/i.test(r.stderr)) {
      throw new Error("Docker 엔진이 꺼져 있습니다. Docker Desktop을 실행한 뒤 다시 시도하세요.");
    }
    return { exitCode: r.code, stdout: r.stdout.slice(0, 32_768), stderr: r.stderr.slice(0, 32_768), ms: Date.now() - started, timedOut: false };
  } catch (e) {
    await run("docker", ["kill", name], { timeout: 5000 }).catch(() => {});
    if (timedOut) return { exitCode: 124, stdout: "", stderr: "10초 제한을 넘어 종료했습니다", ms: Date.now() - started, timedOut: true };
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
