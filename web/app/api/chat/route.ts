// POST /api/chat: 에이전트 루프 이벤트를 SSE로 흘려보낸다
import { runAgent } from "@/lib/agent";
import { parseBody } from "@/lib/chat-body";

export async function POST(req: Request) {
  // JSON이 아닌 요청(text/plain 등 CORS 사전 확인을 건너뛰는 형식)은 받지 않는다
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Content-Type은 application/json이어야 합니다." }, { status: 415 });
  }
  const parsed = parseBody(await req.json().catch(() => null));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const enc = new TextEncoder();
  const ctrl = new AbortController();
  const stream = new ReadableStream({
    async start(c) {
      await runAgent(parsed.history, parsed.question, (e) => c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)), ctrl.signal);
      try {
        c.close();
      } catch {
        /* 이미 취소된 스트림 */
      }
    },
    cancel() {
      ctrl.abort(); // 브라우저가 끊기면 루프와 LLM 요청을 멈춘다
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
