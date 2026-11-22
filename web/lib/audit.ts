// 감사 로그: Neon(Postgres)에 도구 호출을 남긴다. DATABASE_URL이 없으면 메모리에만 기록한다.
import { neon } from "@neondatabase/serverless";
import { mask } from "./mask";

export type Row = { session_id: string; tool: string; args: unknown; ok: boolean; ms: number; tokens_in: number; tokens_out: number; created_at: string };

const g = globalThis as unknown as { __rows?: Row[] };
const rows = (g.__rows ??= []);

// 연결 문자열은 서버 환경변수에만 둔다
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

export async function logCall(r: Omit<Row, "created_at">) {
  // args에 비밀값이 섞여 있을 수 있어 문자열로 바꿔 마스킹한 뒤 저장
  const args = mask(JSON.stringify(r.args ?? {}));
  rows.push({ ...r, args: JSON.parse(args), created_at: new Date().toISOString() });
  if (rows.length > 500) rows.shift();
  if (!sql) return;
  try {
    await sql`insert into tool_calls (session_id, tool, args, ok, ms, tokens_in, tokens_out)
              values (${r.session_id}, ${r.tool}, ${args}::jsonb, ${r.ok}, ${r.ms}, ${r.tokens_in}, ${r.tokens_out})`;
  } catch (e) {
    console.error("감사 로그 저장 실패:", (e as Error).message); // 로그 실패가 답변을 막지 않게 한다
  }
}

/** 사용량 화면용 최근 기록. DB가 있으면 DB에서, 없으면 메모리에서 읽는다. */
export async function recent(): Promise<Row[]> {
  if (!sql) return rows.slice(-200);
  try {
    return (await sql`select session_id, tool, args, ok, ms, tokens_in, tokens_out, created_at::text from tool_calls order by created_at desc limit 500`) as Row[];
  } catch {
    return rows.slice(-200); // DB 오류 시에도 화면은 뜨게 한다
  }
}
