// 질문 분류 테스트: 필요한 도구만 열고, 도구 수에 따라 모델을 고른다
import { describe, it, expect } from "vitest";
import { classify } from "./agent";

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
});
