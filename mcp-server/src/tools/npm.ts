// npm_outdated: 오래된 의존성 목록
import { existsSync } from "node:fs";
import path from "node:path";
import { assertAllowedPath, run } from "../safe.js";

/** npm을 쉘 없이 실행할 방법을 찾는다. Windows의 npm.cmd는 쉘 없이 spawn할 수 없어서 npm-cli.js를 node로 직접 실행한다. */
export function npmCommand(args: string[]): { cmd: string; args: string[] } {
  const dir = path.dirname(process.execPath);
  const candidates = [
    process.env.ENVSCOUT_NPM_CLI,
    path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"), // Windows 설치본
    path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), // macOS·Linux 설치본
  ];
  const cli = candidates.find((c): c is string => !!c && existsSync(c));
  if (cli) return { cmd: process.execPath, args: [cli, ...args] };
  // 못 찾으면 Windows는 cmd.exe로 고정 문자열을 실행한다(사용자 입력이 섞이지 않아 주입 위험 없음)
  if (process.platform === "win32") return { cmd: "cmd.exe", args: ["/d", "/s", "/c", `npm ${args.join(" ")}`] };
  return { cmd: "npm", args };
}

type Outdated = Record<string, { current?: string; wanted: string; latest: string }>;

/** npm outdated --json 결과를 해석한다. 오래된 패키지가 있으면 npm이 exit 1을 반환하므로 코드만으로 실패를 판단하지 않는다. */
export function parseOutdated(stdout: string, stderr: string, code: number) {
  if (!stdout.trim()) {
    if (code === 0) return { count: 0, packages: [] };
    throw new Error(`npm outdated 실패: ${stderr.trim().split("\n").slice(-3).join(" ") || `exit ${code}`}`);
  }
  const data = JSON.parse(stdout) as Outdated & { error?: { summary?: string; code?: string } };
  if (data.error && typeof data.error === "object" && "summary" in data.error) {
    throw new Error(`npm outdated 실패: ${data.error.summary ?? data.error.code}`);
  }
  const packages = Object.entries(data as Outdated).map(([name, v]) => ({ name, current: v.current ?? "미설치", wanted: v.wanted, latest: v.latest }));
  return { count: packages.length, packages };
}

export async function npmOutdated(p: string) {
  const cwd = assertAllowedPath(p);
  if (!existsSync(path.join(cwd, "package.json"))) throw new Error(`package.json이 없는 경로입니다: ${cwd}`);
  const { cmd, args } = npmCommand(["outdated", "--json"]);
  const r = await run(cmd, args, { cwd, timeout: 30000 });
  return parseOutdated(r.stdout, r.stderr, r.code);
}
