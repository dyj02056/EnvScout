// 에이전트 루프: 질문 분류 → 도구 선택 → 실행 → 요약
import { randomUUID } from "node:crypto";
import { callTool, getMcp } from "./mcp";
import { chat, type Block, type Msg, type ToolDef } from "./llm";
import { logCall } from "./audit";

export type Ev =
  | { type: "tool_start"; id: string; tool: string; args: unknown }
  | { type: "tool_end"; id: string; ok: boolean; ms: number; text: string }
  | { type: "text"; text: string }
  | { type: "usage"; tokensIn: number; tokensOut: number }
  | { type: "error"; message: string }
  | { type: "done" };

const MAX_STEPS = 6; // 도구 호출 폭주 방지

const RULES: [RegExp, string[]][] = [
  [/git|커밋|변경|저장소|브랜치/i, ["git_summary"]],
  [/docker|도커|컨테이너/i, ["docker_ps"]],
  [/포트|port/i, ["port_check", "docker_ps"]],
  [/의존성|outdated|npm|패키지|오래/i, ["npm_outdated"]],
  [/실행|돌려|코드|run|테스트해/i, ["run_in_sandbox"]],
];

/** 키워드로 필요한 도구를 좁힌다. 도구가 하나면 작은 모델, 여러 개면 큰 모델. */
export function classify(q: string): { tools: string[] | null; model: "fast" | "smart" } {
  const tools = [...new Set(RULES.filter(([re]) => re.test(q)).flatMap(([, t]) => t))];
  if (tools.length === 0) return { tools: null, model: "smart" }; // 모르면 전부 열어 둔다
  return { tools, model: tools.length <= 1 ? "fast" : "smart" };
}

const SYSTEM = `당신은 개발자 PC의 로컬 환경을 점검해 알려주는 도우미입니다.
- 도구는 읽기 전용입니다. 쓰기·삭제는 할 수 없다고 안내하세요.
- 경로를 묻지 않았다면 ENVSCOUT_ROOTS 안의 현재 프로젝트 경로를 사용하세요: ${process.env.ENVSCOUT_ROOTS ?? process.cwd()}
- 도구가 실패하면 다른 도구로 같은 정보를 확인해 보고, 안 되면 원인과 해결책을 알려주세요.
- 도구 결과는 숫자와 이름 위주로 짧게 요약하세요. 한국어로 답하세요.`;

async function execTool(name: string, args: Record<string, unknown>) {
  // 실패하면 1회만 다시 시도한다 (일시적 오류 대비)
  let r = await callTool(name, args).catch((e: Error) => ({ ok: false, text: e.message }));
  if (!r.ok) r = await callTool(name, args).catch((e: Error) => ({ ok: false, text: e.message }));
  return r;
}

export async function runAgent(question: string, emit: (e: Ev) => void, signal: AbortSignal) {
  const session = randomUUID();
  try {
    const { tools: wanted, model } = classify(question);
    const all = (await (await getMcp()).listTools()).tools;
    const tools: ToolDef[] = all
      .filter((t) => !wanted || wanted.includes(t.name))
      .map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Record<string, unknown> }));

    const messages: Msg[] = [{ role: "user", content: question }];
    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) return;
      const turn = await chat(model, SYSTEM, messages, tools);
      emit({ type: "usage", tokensIn: turn.tokensIn, tokensOut: turn.tokensOut });
      const calls = turn.blocks.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
      const text = turn.blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      if (calls.length === 0) {
        emit({ type: "text", text });
        // 마지막 요약 턴의 토큰도 집계에 들어가도록 기록 (사용량 표에서는 제외)
        void logCall({ session_id: session, tool: "llm", args: {}, ok: true, ms: 0, tokens_in: turn.tokensIn, tokens_out: turn.tokensOut });
        return;
      }
      messages.push({ role: "assistant", content: turn.blocks });
      const results: Block[] = [];
      let first = true;
      for (const c of calls) {
        emit({ type: "tool_start", id: c.id, tool: c.name, args: c.input });
        const t0 = Date.now();
        const r = await execTool(c.name, c.input);
        const ms = Date.now() - t0;
        emit({ type: "tool_end", id: c.id, ok: r.ok, ms, text: r.text.slice(0, 2000) });
        void logCall({ session_id: session, tool: c.name, args: c.input, ok: r.ok, ms, tokens_in: first ? turn.tokensIn : 0, tokens_out: first ? turn.tokensOut : 0 });
        first = false;
        results.push({ type: "tool_result", tool_use_id: c.id, content: r.text, is_error: !r.ok });
      }
      messages.push({ role: "user", content: results });
    }
    emit({ type: "text", text: `도구를 ${MAX_STEPS}번 호출했지만 답이 정리되지 않아 멈췄습니다. 질문을 더 좁혀서 다시 물어보세요.` });
  } catch (e) {
    emit({ type: "error", message: (e as Error).message });
  } finally {
    emit({ type: "done" });
  }
}
