// GET /api/usage: 도구별 호출 수·실패 수·평균 지연·토큰 합계
import { connection } from "next/server";
import { recent } from "@/lib/audit";


export async function GET() {
  await connection(); // 요청마다 최신 기록을 읽도록 정적 생성을 막는다
  const by: Record<string, { calls: number; fails: number; ms: number }> = {};
  let tokensIn = 0, tokensOut = 0;
  for (const r of await recent()) {
    tokensIn += r.tokens_in; tokensOut += r.tokens_out;
    if (r.tool === "llm") continue;
    const t = (by[r.tool] ??= { calls: 0, fails: 0, ms: 0 });
    t.calls++; t.ms += r.ms; if (!r.ok) t.fails++;
  }
  const tools = Object.entries(by).map(([tool, v]) => ({ tool, calls: v.calls, fails: v.fails, avgMs: Math.round(v.ms / v.calls) }));
  return Response.json({ tools, tokensIn, tokensOut });
}
