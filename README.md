# EnvScout

채팅으로 저장소 변경·컨테이너·포트·오래된 의존성을 묻고, AI 에이전트가 읽기 전용 MCP 도구로 점검해 요약합니다.
코드 실행은 네트워크가 차단된 Docker 샌드박스에서만 합니다.

## 실행

```powershell
cd mcp-server; npm install; npm run build
cd ..\web; npm install --legacy-peer-deps
copy .env.local.example .env.local   # 값 채우기
npm run dev
```

## 검증

```powershell
cd mcp-server; npm run typecheck; npm test   # Docker 엔진이 켜져 있어야 샌드박스 테스트가 돈다
cd ..\web; npm run lint; npm run typecheck; npm test; npm run build
```

## 설정

- LLM: Groq (GROQ_API_KEY). 키 없이 개발하려면 LLM=ollama.
- 감사 로그: Neon Postgres (DATABASE_URL). 먼저 
eon/schema.sql을 실행한다. 비워 두면 메모리에만 기록한다.
