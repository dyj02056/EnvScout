// 웹 계층 테스트: Origin 검사, 요청 본문 검사, LLM 메시지 변환, 감사 로그, docker stats 파싱, 자식 프로세스 환경변수
import { describe, it, expect, afterEach } from "vitest";
import { checkRequest } from "./origin";
import { parseBody } from "./chat-body";
import { toOpenAI } from "./llm";
import { sanitizeArgs, aggregate, type Row } from "./audit";
import { parseStats } from "./stats";
import { childEnv } from "./mcp";

describe("checkRequest", () => {
  afterEach(() => { delete process.env.ENVSCOUT_ALLOWED_ORIGINS; });
  const h = (host: string | null, origin: string | null = null, secFetchSite: string | null = null) => ({ host, origin, secFetchSite });

  it("로컬 Host와 같은 Origin은 통과", () => {
    expect(checkRequest(h("localhost:3000", "http://localhost:3000", "same-origin"))).toBeNull();
    expect(checkRequest(h("127.0.0.1:3000", "http://127.0.0.1:3000"))).toBeNull();
    expect(checkRequest(h("[::1]:3000", "http://[::1]:3000"))).toBeNull();
    expect(checkRequest(h("localhost:3000"))).toBeNull(); // curl 등 Origin 없는 요청
  });
  it("다른 사이트의 Origin은 거부(CSRF)", () => {
    expect(checkRequest(h("localhost:3000", "https://evil.example"))).toMatch(/Origin/);
    expect(checkRequest(h("localhost:3000", "null"))).toMatch(/Origin/);
    expect(checkRequest(h("localhost:3000", null, "cross-site"))).toMatch(/다른 사이트/);
  });
  it("로컬이 아닌 Host는 거부(DNS 리바인딩)", () => {
    expect(checkRequest(h("evil.example:3000", "http://evil.example:3000"))).toMatch(/Host/);
    expect(checkRequest(h(null))).toMatch(/Host/);
  });
  it("ENVSCOUT_ALLOWED_ORIGINS에 넣은 주소는 통과", () => {
    process.env.ENVSCOUT_ALLOWED_ORIGINS = "http://mybox:3000";
    expect(checkRequest(h("mybox:3000", "http://mybox:3000"))).toBeNull();
  });
});

describe("parseBody", () => {
  it("질문과 이전 대화를 꺼낸다", () => {
    expect(parseBody({ question: "q", history: [{ q: "a", a: "b" }] })).toEqual({ question: "q", history: [{ q: "a", a: "b" }] });
    expect(parseBody({ question: "q" })).toEqual({ question: "q", history: [] });
  });
  it("잘못된 요청은 거부", () => {
    expect(parseBody(null)).toHaveProperty("error");
    expect(parseBody({ question: " " })).toHaveProperty("error");
    expect(parseBody({ question: "x".repeat(2001) })).toHaveProperty("error");
    expect(parseBody({ question: "q", history: Array(11).fill({ q: "a", a: "b" }) })).toHaveProperty("error");
    expect(parseBody({ question: "q", history: [{ q: 1, a: "b" }] })).toHaveProperty("error");
    expect(parseBody({ question: "q", history: [{ q: "x".repeat(5000), a: "y".repeat(5000) }] })).toHaveProperty("error");
  });
});

describe("toOpenAI", () => {
  it("도구 호출과 결과를 OpenAI 형식으로 바꾼다", () => {
    const out = toOpenAI("sys", [
      { role: "user", content: "질문" },
      { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "git_summary", input: { path: "." } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "{}" }] },
      { role: "assistant", content: "답" },
    ]);
    expect(out).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "질문" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "git_summary", arguments: '{"path":"."}' } }] },
      { role: "tool", tool_call_id: "c1", content: "{}" },
      { role: "assistant", content: "답" },
    ]);
  });
});

describe("감사 로그", () => {
  it("샌드박스 코드는 원문 대신 해시·길이·앞부분만 남긴다", () => {
    const code = "const API_KEY='abc'; " + "x".repeat(500);
    const a = sanitizeArgs("run_in_sandbox", { code }) as { code_sha256: string; code_len: number; preview: string };
    expect(a.code_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.code_len).toBe(code.length);
    expect(a.preview.length).toBeLessThanOrEqual(200);
    expect(a.preview).not.toContain("abc");
  });
  it("다른 도구 인자는 구조를 유지한 채 비밀값만 가린다", () => {
    expect(sanitizeArgs("git_summary", { path: "C:/x", token: "t" })).toEqual({ path: "C:/x", token: "***" });
  });
  it("최근 24시간만 집계하고 llm 행은 표에서 뺀다", () => {
    const now = Date.parse("2026-01-02T00:00:00Z");
    const row = (tool: string, ok: boolean, ms: number, at: string, tin = 0): Row => ({ session_id: "s", tool, args: {}, ok, ms, tokens_in: tin, tokens_out: 0, created_at: at });
    const u = aggregate([
      row("git_summary", true, 10, "2026-01-01T12:00:00Z", 5),
      row("git_summary", false, 30, "2026-01-01T13:00:00Z"),
      row("llm", true, 0, "2026-01-01T14:00:00Z", 7),
      row("docker_ps", true, 99, "2025-12-30T00:00:00Z", 100), // 기간 밖
    ], now);
    expect(u).toEqual({ windowHours: 24, tools: [{ tool: "git_summary", calls: 2, fails: 1, avgMs: 20 }], tokensIn: 12, tokensOut: 0 });
  });
});

describe("parseStats", () => {
  it("컨테이너 수와 메모리 합계(MB)를 계산한다", () => {
    const out = [{ MemUsage: "512MiB / 7.6GiB" }, { MemUsage: "1GiB / 7.6GiB" }, { MemUsage: "512KiB / 1GiB" }].map((r) => JSON.stringify(r)).join("\n");
    expect(parseStats(out)).toEqual({ up: true, count: 3, memMB: 1536.5 });
  });
});

describe("childEnv", () => {
  it("비밀값은 빼고 도구 실행에 필요한 값만 넘긴다", () => {
    const env = childEnv({ PATH: "/bin", Path: "C:\\x", GROQ_API_KEY: "k", DATABASE_URL: "u", ENVSCOUT_ROOTS: "/r", DOCKER_HOST: "d", SystemRoot: "C:\\Windows" });
    expect(env).toEqual({ PATH: "/bin", Path: "C:\\x", ENVSCOUT_ROOTS: "/r", DOCKER_HOST: "d", SystemRoot: "C:\\Windows" });
  });
});
