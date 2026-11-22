// POST /api/chat: 에이전트 루프 이벤트를 SSE로 흘려보낸다
import { runAgent } from "@/lib/agent";


export async function POST(req: Request) {
  const { question } = (await req.json().catch(() => ({}))) as { question?: string };
  if (!question?.trim() || question.length > 2000) {
    return Response.json({ error: "질문을 2000자 이내로 입력하세요." }, { status: 400 });
  }
  const enc = new TextEncoder();
  const ctrl = new AbortController();
  const stream = new ReadableStream({
    async start(c) {
      await runAgent(question, (e) => c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)), ctrl.signal);
      c.close();
    },
    cancel() {
      ctrl.abort(); // 브라우저가 끊기면 루프를 멈춘다
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
