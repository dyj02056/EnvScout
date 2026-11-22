// 에이전트 테스트: 질문 분류, 도구 허용 목록, 재시도 정책, 결과 길이 제한, 중단 처리
import { describe, it, expect, vi } from "vitest";
import { classify, runAgent, capForLlm, LLM_RESULT_MAX, MAX_STEPS, type Deps, type Ev } from "./agent";
import { TransportError } from "./mcp";
import type { Turn, Msg } from "./llm";

describe("classify", () => {
  it("git 질문은 git_summary만, 작은 모델", () => {
    expect(classify("커밋 안 한 변경 있어?")).toEqual({ tools: ["git_summary"], model: "fast" });
  });
  it("포트 질문은 두 도구, 큰 모델", () => {
    const r = classify("3000번 포트 열려 있어?");
    expect(r.tools).toEqual(["port_check", "docker_ps"]);
    expect(r.model).toBe("smart");
  });
  it("모르는 질문은 전체 도구", () => {
    expect(classify("안녕").tools).toBeNull();
  });

  // 화면의 샘플 질문 4개가 의도한 도구로 가는지 확인
  it.each([
    ["커밋 안 한 변경이 있는 저장소가 있어?", ["list_repos", "git_summary"], "smart"],
    ["지금 실행 중인 컨테이너와 포트를 알려줘", ["docker_ps", "port_check"], "smart"],
    ["3000번 포트가 열려 있어?", ["port_check", "docker_ps"], "smart"],
    ["오래된 의존성이 있는지 확인해줘", ["npm_outdated"], "fast"],
  ])("샘플: %s", (q, tools, model) => {
    expect(classify(q)).toEqual({ tools, model });
  });

  it("'실행 중'이나 running에는 샌드박스를 열지 않는다", () => {
    expect(classify("실행 중인 컨테이너 알려줘").tools).not.toContain("run_in_sandbox");
    expect(classify("which containers are running").tools).not.toContain("run_in_sandbox");
  });
  it("코드 실행 요청은 샌드박스를 연다", () => {
    expect(classify("이 코드 실행해줘: console.log(1)").tools).toContain("run_in_sandbox");
    expect(classify("샌드박스에서 돌려봐").tools).toContain("run_in_sandbox");
  });
});

describe("capForLlm", () => {
  it("긴 결과를 자르고 원래 길이를 알린다", () => {
    const s = capForLlm("x".repeat(LLM_RESULT_MAX + 10));
    expect(s.length).toBeLessThan(LLM_RESULT_MAX + 50);
    expect(s).toContain(`원본 ${LLM_RESULT_MAX + 10}자`);
  });
});

// 가짜 의존성: LLM 응답 순서와 도구 결과를 정해 둔다
const TOOLS = ["git_summary", "docker_ps", "port_check", "npm_outdated", "run_in_sandbox", "list_repos"].map((name) => ({ name, inputSchema: {} }));
function fake(turns: Turn[], callTool: Deps["callTool"] = async () => ({ ok: true, text: "{}" })) {
  const seen: Msg[][] = [];
  const deps: Deps = {
    chat: vi.fn(async (_m: unknown, _s: unknown, messages: Msg[]): Promise<Turn> => {
      seen.push(structuredClone(messages));
      return turns.shift() ?? say("끝");
    }),
    callTool: vi.fn(callTool),
    listTools: async () => TOOLS,
    logCall: vi.fn(async () => {}),
  };
  return { deps, seen };
}
const use = (name: string, input: Record<string, unknown> = {}, id = name): Turn => ({ blocks: [{ type: "tool_use", id, name, input }], tokensIn: 10, tokensOut: 5 });
const say = (text: string): Turn => ({ blocks: [{ type: "text", text }], tokensIn: 3, tokensOut: 2 });

async function collect(deps: Deps, q: string, history: { q: string; a: string }[] = [], signal = new AbortController().signal) {
  const evs: Ev[] = [];
  await runAgent(history, q, (e) => evs.push(e), signal, deps);
  return evs;
}

describe("runAgent", () => {
  it("도구를 부르고 결과를 요약한 뒤 done으로 끝난다", async () => {
    const { deps } = fake([use("git_summary", { path: "." }), say("변경 1개")]);
    const evs = await collect(deps, "커밋 안 한 변경 있어?");
    expect(evs.map((e) => e.type)).toEqual(["usage", "tool_start", "tool_end", "usage", "text", "done"]);
    expect(evs.find((e) => e.type === "text")).toMatchObject({ text: "변경 1개" });
  });

  it("이번 질문에 열지 않은 도구는 실행하지 않는다", async () => {
    const { deps } = fake([use("run_in_sandbox", { code: "1" }), say("ok")]);
    const evs = await collect(deps, "커밋 안 한 변경 있어?");
    expect(deps.callTool).not.toHaveBeenCalled();
    expect(evs.find((e) => e.type === "tool_end")).toMatchObject({ ok: false });
  });

  it("도구가 돌려준 오류는 재시도하지 않는다", async () => {
    const { deps } = fake([use("git_summary"), say("ok")], async () => ({ ok: false, text: "허용 목록 밖" }));
    await collect(deps, "커밋 안 한 변경 있어?");
    expect(deps.callTool).toHaveBeenCalledTimes(1);
  });

  it("연결 오류는 한 번 다시 시도한다", async () => {
    let n = 0;
    const { deps } = fake([use("git_summary"), say("ok")], async () => {
      if (n++ === 0) throw new TransportError("끊김");
      return { ok: true, text: "{}" };
    });
    const evs = await collect(deps, "커밋 안 한 변경 있어?");
    expect(deps.callTool).toHaveBeenCalledTimes(2);
    expect(evs.find((e) => e.type === "tool_end")).toMatchObject({ ok: true });
  });

  it("샌드박스는 연결 오류여도 다시 실행하지 않는다", async () => {
    const { deps } = fake([use("run_in_sandbox", { code: "1" }), say("ok")], async () => { throw new TransportError("끊김"); });
    await collect(deps, "이 코드 실행해줘");
    expect(deps.callTool).toHaveBeenCalledTimes(1);
  });

  it("LLM에는 잘린 결과를 넘긴다", async () => {
    const { deps, seen } = fake([use("git_summary"), say("ok")], async () => ({ ok: true, text: "y".repeat(50_000) }));
    await collect(deps, "커밋 안 한 변경 있어?");
    const last = seen[1].at(-1)!;
    const block = (last.content as { type: string; content: string }[])[0];
    expect(block.content.length).toBeLessThan(LLM_RESULT_MAX + 50);
  });

  it("이전 대화를 메시지 앞에 붙인다", async () => {
    const { deps, seen } = fake([say("ok")]);
    await collect(deps, "그럼 3000번은?", [{ q: "8080 열려 있어?", a: "닫혀 있습니다" }]);
    expect(seen[0].map((m) => m.content)).toEqual(["8080 열려 있어?", "닫혀 있습니다", "그럼 3000번은?"]);
  });

  it(`도구 호출이 ${MAX_STEPS}번을 넘으면 멈춘다`, async () => {
    const { deps } = fake(Array.from({ length: MAX_STEPS + 2 }, (_, i) => use("git_summary", {}, `c${i}`)));
    const evs = await collect(deps, "커밋 안 한 변경 있어?");
    expect(deps.chat).toHaveBeenCalledTimes(MAX_STEPS);
    expect(evs.at(-2)).toMatchObject({ type: "text" });
  });

  it("emit이 예외를 던져도(닫힌 스트림) 루프가 터지지 않는다", async () => {
    const { deps } = fake([say("ok")]);
    await expect(runAgent([], "안녕", () => { throw new TypeError("Controller is already closed"); }, new AbortController().signal, deps)).resolves.toBeUndefined();
  });

  it("중단되면 더 이상 이벤트를 보내지 않는다", async () => {
    const ctrl = new AbortController();
    const { deps } = fake([use("git_summary"), say("ok")], async () => { ctrl.abort(); return { ok: true, text: "{}" }; });
    const evs = await collect(deps, "커밋 안 한 변경 있어?", [], ctrl.signal);
    expect(evs.map((e) => e.type)).toEqual(["usage", "tool_start"]);
    expect(deps.chat).toHaveBeenCalledTimes(1);
  });
});
