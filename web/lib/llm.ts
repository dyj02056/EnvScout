// LLM 호출: 기본은 Groq, LLM=ollama 이면 로컬 모델. 둘 다 OpenAI 호환 /chat/completions 형식이라 함수 하나로 처리한다.

export type Msg = { role: "user" | "assistant"; content: string | Block[] };
export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type ToolDef = { name: string; description?: string; input_schema: Record<string, unknown> };
export type Turn = { blocks: Block[]; tokensIn: number; tokensOut: number };

// 단순 질문은 작은 모델, 여러 도구가 필요한 질문은 큰 모델. 모델 이름은 환경변수로 바꿀 수 있다.
const GROQ_MODELS = {
  fast: process.env.GROQ_MODEL_FAST ?? "llama-3.1-8b-instant",
  smart: process.env.GROQ_MODEL_SMART ?? "llama-3.3-70b-versatile",
};

/** messages를 OpenAI 호환 형식으로 바꾼다. 테스트를 위해 분리했다. */
export function toOpenAI(system: string, messages: Msg[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (typeof m.content === "string") { out.push({ role: m.role, content: m.content }); continue; }
    const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const calls = m.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (calls.length) {
      out.push({ role: "assistant", content: text || null, tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) });
    } else if (text) {
      out.push({ role: m.role, content: text });
    }
    for (const b of m.content) if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
  }
  return out;
}

export async function chat(model: "fast" | "smart", system: string, messages: Msg[], tools: ToolDef[], signal?: AbortSignal): Promise<Turn> {
  const local = process.env.LLM === "ollama";
  const url = local ? `${process.env.OLLAMA_URL ?? "http://127.0.0.1:11434"}/v1/chat/completions` : "https://api.groq.com/openai/v1/chat/completions";
  if (!local && !process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY가 설정되지 않았습니다. web/.env.local에 키를 넣고 서버를 다시 시작하세요.");

  const out = toOpenAI(system, messages);

  // 브라우저가 끊기면(signal) 또는 60초가 지나면 요청을 끊는다
  const timeout = AbortSignal.timeout(60_000);
  const res = await fetch(url, {
    method: "POST",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { "Content-Type": "application/json", ...(local ? {} : { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }) },
    body: JSON.stringify({
      model: local ? (process.env.OLLAMA_MODEL ?? "qwen2.5:7b") : GROQ_MODELS[model],
      messages: out,
      tools: tools.length ? tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })) : undefined,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) {
    const hint = res.status === 401 ? "API 키를 확인하세요." : res.status === 429 ? "요청 한도를 넘었습니다. 잠시 뒤 다시 시도하세요." : "";
    throw new Error(`${local ? "Ollama" : "Groq"} 응답 오류 ${res.status}. ${hint}`.trim());
  }
  const j = (await res.json()) as {
    choices?: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const msg = j.choices?.[0]?.message;
  if (!msg) throw new Error(`${local ? "Ollama" : "Groq"} 응답에 결과가 없습니다.`);
  const blocks: Block[] = [];
  if (msg.content) blocks.push({ type: "text", text: msg.content });
  for (const c of msg.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(c.function.arguments || "{}"); } catch { /* 깨진 인자는 빈 객체로 두면 도구가 검증 오류를 돌려준다 */ }
    blocks.push({ type: "tool_use", id: c.id, name: c.function.name, input });
  }
  return { blocks, tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0 };
}
