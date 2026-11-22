// /api/chat 요청 본문 검사
import type { HistoryTurn } from "./agent";

const MAX_Q = 2000;
const MAX_HISTORY = 10;
const MAX_HISTORY_CHARS = 8000;

/** 요청 본문을 검사해 질문과 이전 대화를 꺼낸다. 문제가 있으면 오류 메시지를 돌려준다. */
export function parseBody(body: unknown): { question: string; history: HistoryTurn[] } | { error: string } {
  const { question, history = [] } = (body ?? {}) as { question?: unknown; history?: unknown };
  if (typeof question !== "string" || !question.trim() || question.length > MAX_Q) return { error: `질문을 ${MAX_Q}자 이내로 입력하세요.` };
  if (!Array.isArray(history) || history.length > MAX_HISTORY) return { error: `이전 대화는 ${MAX_HISTORY}개까지 보낼 수 있습니다.` };
  const turns: HistoryTurn[] = [];
  let chars = 0;
  for (const h of history) {
    const { q, a } = (h ?? {}) as { q?: unknown; a?: unknown };
    if (typeof q !== "string" || typeof a !== "string") return { error: "이전 대화 형식이 잘못되었습니다." };
    chars += q.length + a.length;
    turns.push({ q, a });
  }
  if (chars > MAX_HISTORY_CHARS) return { error: "이전 대화가 너무 깁니다. 새 대화를 시작하세요." };
  return { question, history: turns };
}
