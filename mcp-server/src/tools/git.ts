// git_summary: 브랜치, 커밋 안 한 변경, 마지막 커밋
import { assertAllowedPath, run } from "../safe.js";

export async function gitSummary(p: string) {
  const cwd = assertAllowedPath(p);
  const st = await run("git", ["status", "--porcelain=v1", "-b"], { cwd });
  if (st.code !== 0) throw new Error(`git 저장소가 아닙니다: ${st.stderr.trim()}`);
  const [head, ...files] = st.stdout.split("\n").filter(Boolean);
  const last = await run("git", ["log", "-1", "--format=%h %s (%cr)"], { cwd });
  return {
    path: cwd,
    branch: head.replace(/^## /, ""),
    changedCount: files.length,
    changed: files.slice(0, 50),
    lastCommit: last.stdout.trim() || "커밋 없음",
  };
}
