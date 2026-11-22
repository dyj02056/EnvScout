// 에이전트 루프: 질문 분류 → 도구 선택 → 실행 → 요약
import { randomUUID } from "node:crypto";
import { callTool as mcpCallTool, getMcp, TransportError } from "./mcp";
import { chat as llmChat, type Block, type Msg, type ToolDef } from "./llm";
import { logCall as auditLogCall } from "./audit";

export type Ev =
  | { type: "tool_start"; id: string; tool: string; args: unknown }
  | { type: "tool_end"; id: string; ok: boolean; ms: number; text: string }
  | { type: "text"; text: string }
  | { type: "usage"; tokensIn: number; tokensOut: number }
  | { type: "error"; message: string }
  | { type: "done" };

export type HistoryTurn = { q: string; a: string };

export const MAX_STEPS = 6; // 도구 호출 폭주 방지
export const LLM_RESULT_MAX = 8_000; // LLM에 넘기는 도구 결과 최대 길이(문자)
const UI_RESULT_MAX = 2_000; // 화면에 보여 줄 도구 결과 최대 길이
const NO_RETRY = new Set(["run_in_sandbox"]); // 실행할 때마다 결과가 달라지거나 오래 걸리는 도구

const RULES: [RegExp, string[]][] = [
  [/저장소|레포|repo/i, ["list_repos", "git_summary"]],
  [/git|커밋|변경|브랜치/i, ["git_summary"]],
  [/docker|도커|컨테이너|container/i, ["docker_ps"]],
  [/포트|port/i, ["port_check", "docker_ps"]],
  [/의존성|outdated|npm|패키지|오래된/i, ["npm_outdated"]],
  // "실행 중인 컨테이너", "running" 같은 표현에는 걸리지 않게 코드 실행을 뜻하는 말만 본다
  [/샌드박스|sandbox|(코드|스크립트|자바스크립트|\bjs\b|node).*(실행|돌려)|(실행|돌려).*(코드|스크립트)|\brun\b/i, ["run_in_sandbox"]],
];

/** 키워드로 필요한 도구를 좁힌다. 도구가 하나면 작은 모델, 여러 개면 큰 모델. */
export function classify(q: string): { tools: string[] | null; model: "fast" | "smart" } {
  const tools = [...new Set(RULES.filter(([re]) => re.test(q)).flatMap(([, t]) => t))];
  if (tools.length === 0) return { tools: null, model: "smart" }; // 모르면 전부 열어 둔다
  return { tools, model: tools.length <= 1 ? "fast" : "smart" };
}

const SYSTEM = `당신은 개발자 PC의 로컬 환경을 점검해 알려주는 도우미입니다.
- 도구는 읽기 전용입니다. 쓰기·삭제는 할 수 없다고 안내하세요.
- 점검할 수 있는 루트: ${process.env.ENVSCOUT_ROOTS ?? process.cwd()}
- 어떤 저장소가 있는지 모르면 list_repos로 먼저 찾고, 자세한 내용이 필요할 때 git_summary에 그 경로를 넘기세요.
- 도구가 실패하면 다른 도구로 같은 정보를 확인해 보고, 안 되면 원인과 해결책을 알려주세요.
- 도구 결과는 숫자와 이름 위주로 짧게 요약하세요. 마크다운을 써도 됩니다. 한국어로 답하세요.`;

export function capForLlm(text: string): string {
  return text.length > LLM_RESULT_MAX ? `${text.slice(0, LLM_RESULT_MAX)}\n…(잘림, 원본 ${text.length}자)` : text;
}

export type Deps = {
  chat: typeof llmChat;
  callTool: typeof mcpCallTool;
  listTools: () => Promise<{ name: string; description?: string; inputSchema: unknown }[]>;
  logCall: typeof auditLogCall;
};

const defaultDeps: Deps = {
  chat: llmChat,
  callTool: mcpCallTool,
  listTools: async () => (await (await getMcp()).listTools()).tools,
  logCall: auditLogCall,
};

/** 연결 오류만 한 번 다시 시도한다. 도구가 돌려준 오류는 다시 해도 같으므로 그대로 돌려준다. */
async function execTool(deps: Deps, name: string, args: Record<string, unknown>) {
  const once = () => deps.callTool(name, args);
  try {
    return await once();
  } catch (e) {
    if (e instanceof TransportError && !NO_RETRY.has(name)) {
      try {
        return await once();
      } catch (e2) {
        return { ok: false, text: (e2 as Error).message };
      }
    }
    return { ok: false, text: (e as Error).message };
  }
}

export async function runAgent(
  history: HistoryTurn[],
  question: string,
  emit: (e: Ev) => void,
  signal: AbortSignal,
  deps: Deps = defaultDeps,
) {
  // 스트림이 이미 닫혔으면 이벤트를 버린다(브라우저가 끊긴 경우)
  const send = (e: Ev) => {
    if (signal.aborted) return;
    try {
      emit(e);
    } catch {
      /* 닫힌 스트림 */
    }
  };
  const session = randomUUID();
  try {
    const { tools: wanted, model } = classify(question);
    const all = await deps.listTools();
    const tools: ToolDef[] = all
      .filter((t) => !wanted || wanted.includes(t.name))
      .map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Record<string, unknown> }));
    const offered = new Set(tools.map((t) => t.name));

    const messages: Msg[] = [];
    for (const h of history) {
      messages.push({ role: "user", content: h.q });
      if (h.a) messages.push({ role: "assistant", content: h.a });
    }
    messages.push({ role: "user", content: question });

    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) return;
      const turn = await deps.chat(model, SYSTEM, messages, tools, signal);
      send({ type: "usage", tokensIn: turn.tokensIn, tokensOut: turn.tokensOut });
      const calls = turn.blocks.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
      const text = turn.blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      if (calls.length === 0) {
        send({ type: "text", text });
        // 마지막 요약 턴의 토큰도 집계에 들어가도록 기록 (사용량 표에서는 제외)
        void deps.logCall({ session_id: session, tool: "llm", args: {}, ok: true, ms: 0, tokens_in: turn.tokensIn, tokens_out: turn.tokensOut });
        return;
      }
      messages.push({ role: "assistant", content: turn.blocks });
      const results: Block[] = [];
      let first = true;
      for (const c of calls) {
        if (signal.aborted) return;
        send({ type: "tool_start", id: c.id, tool: c.name, args: c.input });
        const t0 = Date.now();
        // 이번 질문에 열어 준 도구만 실행한다
        const r = offered.has(c.name)
          ? await execTool(deps, c.name, c.input)
          : { ok: false, text: `이 질문에서 사용할 수 없는 도구입니다: ${c.name}` };
        const ms = Date.now() - t0;
        send({ type: "tool_end", id: c.id, ok: r.ok, ms, text: r.text.slice(0, UI_RESULT_MAX) });
        void deps.logCall({ session_id: session, tool: c.name, args: c.input, ok: r.ok, ms, tokens_in: first ? turn.tokensIn : 0, tokens_out: first ? turn.tokensOut : 0 });
        first = false;
        results.push({ type: "tool_result", tool_use_id: c.id, content: capForLlm(r.text), is_error: !r.ok });
      }
      messages.push({ role: "user", content: results });
    }
    send({ type: "text", text: `도구를 ${MAX_STEPS}번 호출했지만 답이 정리되지 않아 멈췄습니다. 질문을 더 좁혀서 다시 물어보세요.` });
  } catch (e) {
    if (!signal.aborted) send({ type: "error", message: (e as Error).message });
  } finally {
    send({ type: "done" });
  }
}
