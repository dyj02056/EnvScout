"use client";
// 메인 화면: 왼쪽은 대화, 오른쪽은 조사 기록(호출 궤적·리소스·사용량)
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Ev, HistoryTurn } from "@/lib/agent";
import type { Usage } from "@/lib/audit";

type Step = { id: string; tool: string; args: unknown; state: "run" | "ok" | "fail"; ms?: number; text?: string };
type Turn = { q: string; a: string; err?: string; stopped?: boolean; steps: Step[] };

const SAMPLES = [
  "커밋 안 한 변경이 있는 저장소가 있어?",
  "지금 실행 중인 컨테이너와 포트를 알려줘",
  "3000번 포트가 열려 있어?",
  "오래된 의존성이 있는지 확인해줘",
];
const HISTORY_TURNS = 5;
const HISTORY_CHARS = 7000; // 서버 제한(8000자)보다 조금 작게

/** 이어지는 질문에 넘길 이전 대화. 답을 받은 턴만, 최근 것부터 길이 제한 안에서 고른다. */
function buildHistory(turns: Turn[]): HistoryTurn[] {
  const out: HistoryTurn[] = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0 && out.length < HISTORY_TURNS; i--) {
    const t = turns[i];
    if (!t.a || t.err) continue;
    const a = t.a.slice(0, 1500);
    if (chars + t.q.length + a.length > HISTORY_CHARS) break;
    chars += t.q.length + a.length;
    out.unshift({ q: t.q, a });
  }
  return out;
}

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [selected, setSelected] = useState<number | null>(null); // 궤적을 볼 턴(null이면 마지막)
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mem, setMem] = useState<number[]>([]);
  const [stat, setStat] = useState({ up: true, count: 0, memMB: 0 });
  const [usage, setUsage] = useState<Usage | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 컨테이너 리소스는 3초마다 갱신. 탭이 숨겨졌거나 이전 요청이 아직 안 끝났으면 건너뛴다.
  useEffect(() => {
    let inFlight = false;
    const tick = async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const s = await fetch("/api/stats").then((r) => r.json()).catch(() => null);
        if (!s) return;
        setStat(s);
        setMem((m) => [...m.slice(-29), s.memMB]);
      } finally {
        inFlight = false;
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  const loadUsage = () => fetch("/api/usage").then((r) => r.json()).then(setUsage).catch(() => {});
  useEffect(() => { loadUsage(); }, []);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: "end" }); }, [turns]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    const history = buildHistory(turns);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true); setInput(""); setSelected(null);
    setTurns((t) => [...t, { q: question, a: "", steps: [] }]);
    const patch = (f: (x: Turn) => Turn) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? f(x) : x)));
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? "서버에 연결하지 못했습니다.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", sawDone = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          if (!p.startsWith("data: ")) continue;
          const e = JSON.parse(p.slice(6)) as Ev;
          if (e.type === "tool_start") patch((x) => ({ ...x, steps: [...x.steps, { id: e.id, tool: e.tool, args: e.args, state: "run" }] }));
          else if (e.type === "tool_end") patch((x) => ({ ...x, steps: x.steps.map((s) => (s.id === e.id ? { ...s, state: e.ok ? "ok" : "fail", ms: e.ms, text: e.text } : s)) }));
          else if (e.type === "text") patch((x) => ({ ...x, a: e.text }));
          else if (e.type === "error") patch((x) => ({ ...x, err: e.message }));
          else if (e.type === "done") sawDone = true;
        }
      }
      if (!sawDone) patch((x) => ({ ...x, err: "응답이 중간에 끊겼습니다. 다시 시도하세요." }));
    } catch (e) {
      if (ctrl.signal.aborted) patch((x) => ({ ...x, stopped: true }));
      else patch((x) => ({ ...x, err: (e as Error).message }));
    } finally {
      abortRef.current = null;
      setBusy(false);
      loadUsage();
    }
  }

  const shownIdx = selected ?? turns.length - 1;
  const shown = turns[shownIdx];
  const steps = shown?.steps ?? [];

  const max = Math.max(1, ...mem);
  const points = mem.map((v, i) => `${(i / Math.max(1, mem.length - 1)) * 140},${36 - (v / max) * 34}`).join(" ");

  return (
    <main className="app">
      <section className="chat">
        <h1 className="brand">EnvScout</h1>
        <p className="sub">저장소 변경, 컨테이너, 포트, 오래된 의존성을 물어보세요. 읽기만 하고, 코드 실행은 격리된 컨테이너에서만 합니다.</p>
        <div className="log" aria-live="polite">
          {turns.length === 0 && (
            <div className="empty">
              이런 질문부터 해볼 수 있습니다.
              <ul>{SAMPLES.map((s) => <li key={s}><button onClick={() => ask(s)}>{s}</button></li>)}</ul>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={i === shownIdx && turns.length > 1 ? "turn shown" : "turn"}>
              <p className="q">{t.q}</p>
              {t.a && <div className="a"><ReactMarkdown remarkPlugins={[remarkGfm]}>{t.a}</ReactMarkdown></div>}
              {t.err && <p className="err" role="alert">{t.err}</p>}
              {t.stopped && <p className="note">중지했습니다.</p>}
              {!t.a && !t.err && !t.stopped && i === turns.length - 1 && busy && <p className="note">점검 중…</p>}
              {t.steps.length > 0 && i !== shownIdx && (
                <button type="button" className="link" onClick={() => setSelected(i)}>호출 궤적 보기 ({t.steps.length})</button>
              )}
            </div>
          ))}
          <div ref={logEnd} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={turns.length ? "이어서 물어보세요" : "무엇을 점검할까요?"} aria-label="질문" maxLength={2000} />
          {busy
            ? <button type="button" className="stop" onClick={() => abortRef.current?.abort()}>중지</button>
            : <button disabled={!input.trim()}>보내기</button>}
        </form>
      </section>

      <aside className="sheet" aria-label="조사 기록">
        <section>
          <h2>호출 궤적{shown && turns.length > 1 ? <span className="note"> · {shownIdx + 1}번째 질문</span> : null}</h2>
          {steps.length === 0 ? <p className="note">질문하면 에이전트가 부른 도구가 여기에 순서대로 쌓입니다.</p> : (
            <ol className="trail">
              {steps.map((s) => (
                <li key={s.id} className={s.state === "ok" ? "" : s.state}>
                  <div className="t"><span>{s.tool}</span><span className="ms">{s.state === "run" ? "실행 중" : `${s.ms}ms${s.state === "fail" ? " · 실패" : ""}`}</span></div>
                  <code>{JSON.stringify(s.args)}</code>
                  {s.text && <pre>{s.text}</pre>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h2>컨테이너 리소스</h2>
          {stat.up ? (
            <div className="res">
              <div><strong>{stat.count}</strong>개 실행 중<br /><span className="note">메모리 {stat.memMB}MB</span></div>
              {mem.length > 1 && <svg className="spark" viewBox="0 0 140 36" role="img" aria-label="메모리 추이"><polyline points={points} /></svg>}
            </div>
          ) : <p className="note">Docker 엔진이 꺼져 있습니다. Docker Desktop을 실행하면 표시됩니다.</p>}
        </section>

        <section>
          <h2>도구 사용량 <span className="note">· 최근 {usage?.windowHours ?? 24}시간</span></h2>
          {!usage || usage.tools.length === 0 ? <p className="note">아직 호출 기록이 없습니다.</p> : (
            <>
              <table>
                <thead><tr><th>도구</th><th className="n">호출</th><th className="n">실패</th><th className="n">평균</th></tr></thead>
                <tbody>{usage.tools.map((u) => (
                  <tr key={u.tool}><td>{u.tool}</td><td className="n">{u.calls}</td><td className={`n ${u.fails ? "bad" : ""}`}>{u.fails}</td><td className="n">{u.avgMs}ms</td></tr>
                ))}</tbody>
              </table>
              <p className="note" style={{ marginTop: 8 }}>토큰 입력 {usage.tokensIn.toLocaleString()} · 출력 {usage.tokensOut.toLocaleString()}</p>
            </>
          )}
        </section>
      </aside>
    </main>
  );
}
