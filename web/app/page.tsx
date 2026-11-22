"use client";
// 메인 화면: 왼쪽은 대화, 오른쪽은 조사 기록(호출 궤적·리소스·사용량)
import { useEffect, useRef, useState } from "react";
import type { Ev } from "@/lib/agent";

type Step = { id: string; tool: string; args: unknown; state: "run" | "ok" | "fail"; ms?: number; text?: string };
type Turn = { q: string; a: string; err?: string };
type Usage = { tools: { tool: string; calls: number; fails: number; avgMs: number }[]; tokensIn: number; tokensOut: number };

const SAMPLES = [
  "커밋 안 한 변경이 있는 저장소가 있어?",
  "지금 실행 중인 컨테이너와 포트를 알려줘",
  "3000번 포트가 열려 있어?",
  "오래된 의존성이 있는지 확인해줘",
];

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mem, setMem] = useState<number[]>([]);
  const [stat, setStat] = useState({ up: true, count: 0, memMB: 0 });
  const [usage, setUsage] = useState<Usage | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  // 컨테이너 리소스는 3초마다 갱신. 탭이 숨겨지면 요청하지 않는다.
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      const s = await fetch("/api/stats").then((r) => r.json()).catch(() => null);
      if (!s) return;
      setStat(s);
      setMem((m) => [...m.slice(-29), s.memMB]);
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
    setBusy(true); setInput(""); setSteps([]);
    setTurns((t) => [...t, { q: question, a: "" }]);
    const patch = (p: Partial<Turn>) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, ...p } : x)));
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
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
          const e = JSON.parse(p.replace(/^data: /, "")) as Ev;
          if (e.type === "tool_start") setSteps((s) => [...s, { id: e.id, tool: e.tool, args: e.args, state: "run" }]);
          else if (e.type === "tool_end") setSteps((s) => s.map((x) => (x.id === e.id ? { ...x, state: e.ok ? "ok" : "fail", ms: e.ms, text: e.text } : x)));
          else if (e.type === "text") patch({ a: e.text });
          else if (e.type === "error") patch({ err: e.message });
          else if (e.type === "done") sawDone = true;
        }
      }
      if (!sawDone) patch({ err: "응답이 중간에 끊겼습니다. 다시 시도하세요." });
    } catch (e) {
      patch({ err: (e as Error).message });
    } finally {
      setBusy(false);
      loadUsage();
    }
  }

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
            <div key={i}>
              <p className="q">{t.q}</p>
              {t.a && <p className="a">{t.a}</p>}
              {t.err && <p className="err" role="alert">{t.err}</p>}
              {!t.a && !t.err && i === turns.length - 1 && busy && <p className="note">점검 중…</p>}
            </div>
          ))}
          <div ref={logEnd} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="무엇을 점검할까요?" aria-label="질문" maxLength={2000} />
          <button disabled={busy || !input.trim()}>보내기</button>
        </form>
      </section>

      <aside className="sheet" aria-label="조사 기록">
        <section>
          <h2>호출 궤적</h2>
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
              <svg className="spark" viewBox="0 0 140 36" role="img" aria-label="메모리 추이"><polyline points={points} /></svg>
            </div>
          ) : <p className="note">Docker 엔진이 꺼져 있습니다. Docker Desktop을 실행하면 표시됩니다.</p>}
        </section>

        <section>
          <h2>도구 사용량</h2>
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
