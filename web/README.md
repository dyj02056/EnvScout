# EnvScout web

EnvScout의 화면과 에이전트 루프입니다. 설치와 설정은 [루트 README](../README.md)를 보세요.

## 구조

| 파일 | 역할 |
| --- | --- |
| `app/page.tsx` | 대화 화면, 호출 궤적, 컨테이너 리소스, 도구 사용량 |
| `app/api/chat/route.ts` | 에이전트 이벤트를 SSE로 스트리밍 |
| `app/api/stats/route.ts` | `docker stats` 요약(2초 캐시) |
| `app/api/usage/route.ts` | 최근 24시간 도구 사용량 |
| `proxy.ts` | `/api/*`의 Host·Origin 검사 |
| `lib/agent.ts` | 질문 분류 → 도구 선택 → 실행 → 요약 루프 |
| `lib/llm.ts` | Groq/Ollama(OpenAI 호환) 호출 |
| `lib/mcp.ts` | MCP 서버 자식 프로세스 연결과 재연결 |
| `lib/audit.ts` | 감사 로그(Neon 또는 메모리) |

## 명령

```powershell
npm run dev        # 127.0.0.1:3000
npm test           # 단위 + 통합(mcp-server 빌드 필요)
npm run typecheck
npm run lint
npm run build
```
