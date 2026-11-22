// git_summary: 브랜치, 커밋 안 한 변경, 마지막 커밋
import { assertAllowedPath, run } from "../safe.js";

// 한글 파일명이 \354\225… 처럼 이스케이프되지 않게 한다
const GIT = ["-c", "core.quotePath=false"];

/** git status --porcelain=v1 -b -z 출력에서 브랜치와 변경 파일 목록을 꺼낸다. */
export function parseStatus(out: string): { branch: string; files: string[] } {
  const parts = out.split("\0").filter(Boolean);
  let branch = "";
  const files: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith("## ")) { branch = p.slice(3); continue; }
    // 이름 바꾸기/복사(R, C)는 다음 항목이 원래 이름이다
    if (/^[RC]/.test(p)) { files.push(`${p} <- ${parts[i + 1] ?? ""}`); i++; continue; }
    files.push(p);
  }
  return { branch, files };
}

export function gitError(stderr: string): Error {
  if (/dubious ownership/i.test(stderr)) {
    return new Error("git이 이 폴더의 소유자를 신뢰하지 않습니다. `git config --global --add safe.directory <경로>`로 등록한 뒤 다시 시도하세요.");
  }
  return new Error(`git 저장소가 아닙니다: ${stderr.trim()}`);
}

export async function gitSummary(p: string) {
  const cwd = assertAllowedPath(p);
  const st = await run("git", [...GIT, "status", "--porcelain=v1", "-b", "-z"], { cwd });
  if (st.code !== 0) throw gitError(st.stderr);
  const { branch, files } = parseStatus(st.stdout);
  const last = await run("git", [...GIT, "log", "-1", "--format=%h %s (%cr)"], { cwd });
  return {
    path: cwd,
    branch,
    changedCount: files.length,
    changed: files.slice(0, 50),
    lastCommit: last.stdout.trim() || "커밋 없음",
  };
}

/** 변경 파일 수만 빠르게 센다(list_repos용). */
export async function changedCount(cwd: string): Promise<{ branch: string; changedCount: number } | { error: string }> {
  const st = await run("git", [...GIT, "status", "--porcelain=v1", "-b", "-z"], { cwd });
  if (st.code !== 0) return { error: gitError(st.stderr).message };
  const { branch, files } = parseStatus(st.stdout);
  return { branch, changedCount: files.length };
}
