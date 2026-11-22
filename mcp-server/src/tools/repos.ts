// list_repos: 허용 루트 아래의 git 저장소를 찾아 변경 수와 함께 돌려준다
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { roots } from "../safe.js";
import { changedCount } from "./git.js";

const SKIP = new Set(["node_modules", "dist", "build", "out", "vendor", "target", "__pycache__"]);
export const MAX_REPOS = 50;

/** 루트부터 depth 단계 아래까지 .git이 있는 폴더를 찾는다. 저장소 안으로는 더 내려가지 않는다. */
export function findRepos(root: string, depth: number, limit = MAX_REPOS): string[] {
  const found: string[] = [];
  const walk = (dir: string, d: number) => {
    if (found.length >= limit) return;
    if (existsSync(path.join(dir, ".git"))) { found.push(dir); return; }
    if (d >= depth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 권한 없는 폴더는 건너뛴다
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP.has(e.name)) continue;
      walk(path.join(dir, e.name), d + 1);
      if (found.length >= limit) return;
    }
  };
  walk(root, 0);
  return found;
}

export async function listRepos(depth = 2) {
  const d = Math.min(Math.max(Math.floor(depth), 0), 4);
  const repos: string[] = [];
  for (const r of roots()) {
    for (const p of findRepos(r, d, MAX_REPOS - repos.length)) if (!repos.includes(p)) repos.push(p);
  }
  const results = await Promise.all(repos.map(async (p) => ({ path: p, ...(await changedCount(p)) })));
  return {
    count: results.length,
    truncated: results.length >= MAX_REPOS,
    dirtyCount: results.filter((r) => "changedCount" in r && r.changedCount > 0).length,
    repos: results,
  };
}
