// 감사 로그: Neon(Postgres)에 도구 호출을 남긴다. DATABASE_URL이 없으면 메모리에만 기록한다.
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { maskDeep, mask } from "@envscout/shared";

export type Row = { session_id: string; tool: string; args: unknown; ok: boolean; ms: number; tokens_in: number; tokens_out: number; created_at: string };
export type ToolUsage = { tool: string; calls: number; fails: number; avgMs: number };
export type Usage = { windowHours: number; tools: ToolUsage[]; tokensIn: number; tokensOut: number };

export const WINDOW_HOURS = 24; // 사용량 화면 집계 기간
const MEM_MAX = 2000;

const g = globalThis as unknown as { __rows?: Row[]; __pruneDay?: string };
const rows = (g.__rows ??= []);

// 연결 문자열은 서버 환경변수에만 둔다
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

function retentionDays(): number {
  const n = Number(process.env.ENVSCOUT_LOG_RETENTION_DAYS ?? 30);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

/** 저장할 인자를 만든다. 샌드박스 코드는 원문 대신 해시·길이·앞부분만 남기고, 나머지는 비밀값을 가린다. */
export function sanitizeArgs(tool: string, args: unknown): unknown {
  if (tool === "run_in_sandbox" && args && typeof args === "object" && typeof (args as { code?: unknown }).code === "string") {
    const code = (args as { code: string }).code;
    return { code_sha256: createHash("sha256").update(code).digest("hex"), code_len: code.length, preview: mask(code.slice(0, 200)) };
  }
  return maskDeep(args ?? {});
}

/** 하루에 한 번 보존 기간이 지난 기록을 지운다. */
async function pruneDaily() {
  if (!sql) return;
  const today = new Date().toISOString().slice(0, 10);
  if (g.__pruneDay === today) return;
  g.__pruneDay = today;
  try {
    await sql`delete from tool_calls where created_at < now() - make_interval(days => ${retentionDays()})`;
  } catch (e) {
    console.error("감사 로그 정리 실패:", (e as Error).message);
  }
}

export async function logCall(r: Omit<Row, "created_at">) {
  try {
    const args = sanitizeArgs(r.tool, r.args);
    rows.push({ ...r, args, created_at: new Date().toISOString() });
    if (rows.length > MEM_MAX) rows.shift();
    if (!sql) return;
    void pruneDaily();
    await sql`insert into tool_calls (session_id, tool, args, ok, ms, tokens_in, tokens_out)
              values (${r.session_id}, ${r.tool}, ${JSON.stringify(args)}::jsonb, ${r.ok}, ${r.ms}, ${r.tokens_in}, ${r.tokens_out})`;
  } catch (e) {
    console.error("감사 로그 저장 실패:", (e as Error).message); // 로그 실패가 답변을 막지 않게 한다
  }
}

/** 메모리 기록에서 최근 WINDOW_HOURS 동안의 사용량을 집계한다. */
export function aggregate(list: Row[], now = Date.now()): Usage {
  const since = now - WINDOW_HOURS * 3600_000;
  const by: Record<string, { calls: number; fails: number; ms: number }> = {};
  let tokensIn = 0, tokensOut = 0;
  for (const r of list) {
    if (Date.parse(r.created_at) < since) continue;
    tokensIn += r.tokens_in; tokensOut += r.tokens_out;
    if (r.tool === "llm") continue;
    const t = (by[r.tool] ??= { calls: 0, fails: 0, ms: 0 });
    t.calls++; t.ms += r.ms; if (!r.ok) t.fails++;
  }
  const tools = Object.entries(by).map(([tool, v]) => ({ tool, calls: v.calls, fails: v.fails, avgMs: Math.round(v.ms / v.calls) }));
  return { windowHours: WINDOW_HOURS, tools, tokensIn, tokensOut };
}

/** 사용량 화면용 집계. DB가 있으면 DB에서 같은 기간을 집계하고, 없거나 오류면 메모리에서 집계한다. */
export async function usage(): Promise<Usage> {
  if (!sql) return aggregate(rows);
  try {
    const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
    const res = (await sql`
      select tool, count(*)::int as calls, count(*) filter (where not ok)::int as fails, coalesce(avg(ms), 0)::float as avg_ms,
             coalesce(sum(tokens_in), 0)::int as tin, coalesce(sum(tokens_out), 0)::int as tout
      from tool_calls where created_at >= ${since}::timestamptz group by tool`) as { tool: string; calls: number; fails: number; avg_ms: number; tin: number; tout: number }[];
    let tokensIn = 0, tokensOut = 0;
    const tools: ToolUsage[] = [];
    for (const r of res) {
      tokensIn += r.tin; tokensOut += r.tout;
      if (r.tool !== "llm") tools.push({ tool: r.tool, calls: r.calls, fails: r.fails, avgMs: Math.round(r.avg_ms) });
    }
    return { windowHours: WINDOW_HOURS, tools, tokensIn, tokensOut };
  } catch {
    return aggregate(rows); // DB 오류 시에도 화면은 뜨게 한다
  }
}
