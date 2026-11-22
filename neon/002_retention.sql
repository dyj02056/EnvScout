-- EnvScout 감사 로그 2차 변경. schema.sql 다음에 한 번 실행한다(다시 실행해도 안전).
-- 세션별 조회용 인덱스
create index if not exists tool_calls_session_idx on tool_calls (session_id);
-- 도구별 기간 집계(/api/usage)용 인덱스
create index if not exists tool_calls_tool_created_idx on tool_calls (tool, created_at desc);

-- 보존 기간: 앱이 하루에 한 번 ENVSCOUT_LOG_RETENTION_DAYS(기본 30일)보다 오래된 행을 지운다.
-- 수동으로 정리하려면:
--   delete from tool_calls where created_at < now() - interval '30 days';

-- run_in_sandbox 인자는 이제 코드 원문 대신 {code_sha256, code_len, preview}만 저장한다.
-- 예전에 쌓인 원문을 같은 형태로 줄이려면(선택):
--   update tool_calls
--      set args = jsonb_build_object('code_sha256', encode(sha256(convert_to(args->>'code', 'UTF8')), 'hex'),
--                                    'code_len', length(args->>'code'),
--                                    'preview', left(args->>'code', 200))
--    where tool = 'run_in_sandbox' and args ? 'code';
