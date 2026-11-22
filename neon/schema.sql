-- EnvScout 감사 로그. Neon 콘솔의 SQL Editor에 붙여 넣어 한 번 실행한다.
create table if not exists tool_calls (
  id bigint generated always as identity primary key,
  session_id text not null,
  tool text not null,
  args jsonb not null default '{}',
  ok boolean not null,
  ms integer not null,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists tool_calls_created_idx on tool_calls (created_at desc);

-- Neon에는 Supabase 같은 anon/service 역할이 없다. 접근은 연결 문자열을 가진 서버만 가능하므로
-- DATABASE_URL은 서버 환경변수로만 두고 브라우저 코드에는 절대 넣지 않는다.
