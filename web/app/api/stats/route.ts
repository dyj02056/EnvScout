// GET /api/stats: 실행 중인 컨테이너 수와 메모리 합계 (docker stats 한 번)
import { connection } from "next/server";
import { dockerStats } from "@/lib/stats";

export async function GET() {
  await connection(); // 빌드 때 결과가 고정되지 않도록 요청마다 실행
  return Response.json(await dockerStats());
}
