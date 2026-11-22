// docker stats 결과를 짧게 캐시한다. 여러 탭이 동시에 요청해도 docker는 한 번만 실행된다.
import { execFile } from "node:child_process";

export type Stats = { up: boolean; count: number; memMB: number };

const UNIT: Record<string, number> = { B: 1 / 1048576, kB: 1 / 1024, KB: 1 / 1024, KiB: 1 / 1024, MB: 1, MiB: 1, GB: 1024, GiB: 1024 };
const TTL_MS = 2000;

const g = globalThis as unknown as { __stats?: { at: number; p: Promise<Stats> } };

/** docker stats --format {{json .}} 출력에서 컨테이너 수와 메모리 합계(MB)를 계산한다. */
export function parseStats(stdout: string): Stats {
  const rows = stdout.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { MemUsage?: string });
  const memMB = rows.reduce((s, r) => {
    const m = /([\d.]+)\s*([kKMG]?i?B)/.exec(r.MemUsage ?? "");
    return s + (m ? parseFloat(m[1]) * (UNIT[m[2]] ?? 0) : 0);
  }, 0);
  return { up: true, count: rows.length, memMB: Math.round(memMB * 10) / 10 };
}

function run(): Promise<Stats> {
  return new Promise((resolve) => {
    execFile("docker", ["stats", "--no-stream", "--format", "{{json .}}"], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve({ up: false, count: 0, memMB: 0 });
      try {
        resolve(parseStats(stdout));
      } catch {
        resolve({ up: false, count: 0, memMB: 0 });
      }
    });
  });
}

export function dockerStats(): Promise<Stats> {
  const c = g.__stats;
  // 진행 중이거나 TTL 안의 결과가 있으면 재사용한다
  if (c && Date.now() - c.at < TTL_MS) return c.p;
  const p = run();
  g.__stats = { at: Date.now(), p };
  // 실행이 오래 걸렸으면 끝난 시점부터 TTL을 센다
  void p.then(() => { if (g.__stats?.p === p) g.__stats.at = Date.now(); });
  return p;
}
