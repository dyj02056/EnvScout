// GET /api/stats: 실행 중인 컨테이너 수와 메모리 합계 (docker stats 한 번)
import { execFile } from "node:child_process";


const UNIT: Record<string, number> = { B: 1 / 1048576, KiB: 1 / 1024, MiB: 1, GiB: 1024 };

export function GET() {
  return new Promise<Response>((resolve) => {
    execFile("docker", ["stats", "--no-stream", "--format", "{{json .}}"], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(Response.json({ up: false, count: 0, memMB: 0 }));
      const rows = stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { MemUsage: string });
      const memMB = rows.reduce((s, r) => {
        const m = /([\d.]+)\s*([KMG]?i?B)/.exec(r.MemUsage);
        return s + (m ? parseFloat(m[1]) * (UNIT[m[2]] ?? 0) : 0);
      }, 0);
      resolve(Response.json({ up: true, count: rows.length, memMB: Math.round(memMB * 10) / 10 }));
    });
  });
}
