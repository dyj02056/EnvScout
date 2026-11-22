// GET /api/usage: 최근 24시간 도구별 호출 수·실패 수·평균 지연·토큰 합계
import { connection } from "next/server";
import { usage } from "@/lib/audit";

export async function GET() {
  await connection(); // 요청마다 최신 기록을 읽도록 정적 생성을 막는다
  return Response.json(await usage());
}
