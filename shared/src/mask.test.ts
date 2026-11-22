// 마스킹 테스트: 비밀값은 가리고 JSON 구조는 깨지지 않아야 한다
import { describe, it, expect } from "vitest";
import { mask, maskDeep } from "./mask.js";

describe("mask", () => {
  it("키와 토큰을 가린다", () => {
    const s = mask("ANTHROPIC_API_KEY=sk-ant-abcdefgh12345 token ghp_abcdefghijklmnopqrstuv Bearer abc.def-123456");
    expect(s).not.toMatch(/sk-ant-abcdefgh/);
    expect(s).not.toMatch(/ghp_abcdef/);
    expect(s).not.toMatch(/abc\.def-123456/);
    expect(s).toContain("ANTHROPIC_API_KEY=***");
    expect(mask("gsk_abcdefghijklmnopqrstuvwx postgresql://u:pw@ep.neon.tech/db")).not.toMatch(/gsk_abc|pw@/);
  });

  it("따옴표로 감싼 값도 가린다", () => {
    expect(mask(`API_KEY="hello world"`)).toBe("API_KEY=***");
  });

  it("JSON 문자열을 마스킹해도 다시 파싱된다", () => {
    const s = mask(JSON.stringify({ code: "const API_KEY=abc; run()", n: 1 }));
    const back = JSON.parse(s) as { code: string; n: number };
    expect(back.code).not.toContain("abc");
    expect(back.n).toBe(1);
  });

  it("직렬화된 문자열 안의 따옴표 값도 구조를 깨지 않는다", () => {
    const s = mask(JSON.stringify({ code: `const TOKEN = "abc"` }));
    expect(JSON.parse(s)).toEqual({ code: "const TOKEN = ***" });
  });

  it("JSON 텍스트 안의 비밀 키 값을 가린다", () => {
    const s = mask(`{"apiKey":"secret123","name":"ok"}`);
    expect(s).not.toContain("secret123");
    expect(JSON.parse(s)).toEqual({ apiKey: "***", name: "ok" });
  });

  it("평범한 JSON 값은 건드리지 않는다", () => {
    const raw = `{"name":"js-tokens","current":"4.0.0"}`;
    expect(mask(raw)).toBe(raw);
  });
});

describe("maskDeep", () => {
  it("구조는 두고 문자열과 비밀 키만 가린다", () => {
    const out = maskDeep({ code: "x GROQ_API_KEY=gsk_aaaaaaaaaaaaaaaaaaaaaaaa", password: "p", nested: [{ token: "t" }], ms: 3 });
    expect(out).toEqual({ code: "x GROQ_API_KEY=***", password: "***", nested: [{ token: "***" }], ms: 3 });
  });
});
