// 경로 허용 목록 검사 + 쉘 없는 명령 실행 + 출력 마스킹
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { mask } from "@envscout/shared";

const MAX_OUT = 64 * 1024;

// 허용 루트는 환경변수로만 지정한다. 기본은 서버 실행 위치. 여러 개는 path.delimiter(Windows ;, 그 외 :)로 구분.
// shortcut: 루트 변경은 재시작 필요, UI에서 바꾸는 기능은 필요해지면 추가
export function roots(): string[] {
  const raw = process.env.ENVSCOUT_ROOTS ?? process.cwd();
  return raw.split(path.delimiter).filter(Boolean).map((r) => realpathSync(path.resolve(r)));
}

/** 허용 루트 안의 실제 경로만 통과시킨다. 심볼릭 링크와 .. 는 realpath로 풀어서 비교. */
export function assertAllowedPath(p: string): string {
  let real: string;
  try {
    real = realpathSync(path.resolve(p));
  } catch {
    throw new Error(`경로를 찾을 수 없습니다: ${p}`);
  }
  const ok = roots().some((r) => {
    const rel = path.relative(r, real);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!ok) throw new Error(`허용 목록 밖 경로입니다: ${p}`);
  return real;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** 쉘을 거치지 않으므로 args에 ; | 가 들어와도 명령이 이어지지 않는다. 실패(exit != 0)도 결과로 돌려준다. */
export function run(cmd: string, args: string[], opts: { cwd?: string; timeout?: number; input?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = execFile(
        cmd,
        args,
        { cwd: opts.cwd, timeout: opts.timeout ?? 5000, maxBuffer: MAX_OUT * 4, windowsHide: true, shell: false },
        (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;
          if (e && (e.code === "ENOENT" || e.killed)) {
            return reject(new Error(e.killed ? `시간 초과: ${cmd}` : `${cmd} 을(를) 찾을 수 없습니다`));
          }
          const code = e ? (typeof e.code === "number" ? e.code : 1) : 0;
          resolve({ stdout: cap(stdout), stderr: cap(stderr), code });
        },
      );
    } catch (e) {
      // Windows에서 .cmd/.bat을 쉘 없이 실행하면 spawn이 EINVAL을 동기적으로 던진다
      const code = (e as NodeJS.ErrnoException).code;
      return reject(new Error(`${cmd} 실행 실패${code ? ` (${code})` : ""}: ${(e as Error).message}`));
    }
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

function cap(s: string): string {
  return mask(s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "\n…(잘림)" : s);
}
