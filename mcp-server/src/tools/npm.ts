// npm_outdated: 오래된 의존성 목록
import { assertAllowedPath, run } from "../safe.js";

export async function npmOutdated(p: string) {
  const cwd = assertAllowedPath(p);
  // Windows에서는 npm이 npm.cmd 이므로 쉘 없이 실행하려면 이름을 맞춘다
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = await run(npm, ["outdated", "--json"], { cwd, timeout: 30000 });
  // 오래된 패키지가 있으면 npm이 exit 1을 반환하므로 정상으로 본다
  if (!r.stdout.trim()) return { count: 0, packages: [] };
  const data = JSON.parse(r.stdout) as Record<string, { current?: string; wanted: string; latest: string }>;
  const packages = Object.entries(data).map(([name, v]) => ({ name, current: v.current ?? "미설치", wanted: v.wanted, latest: v.latest }));
  return { count: packages.length, packages };
}
