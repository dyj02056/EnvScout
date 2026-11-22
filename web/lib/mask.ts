// mcp-server/src/mask.ts 사본. shortcut: 패키지 공유는 워크스페이스로 묶을 때 정리
const PATTERNS: RegExp[] = [
  /gsk_[A-Za-z0-9]{20,}/g, // Groq 키
  /postgres(?:ql)?:\/\/[^\s"]+/gi, // Neon 연결 문자열(비밀번호 포함)
  /sk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic 키
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI류 키
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub 토큰
  /AKIA[0-9A-Z]{16}/g, // AWS 액세스 키
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];
// KEY=값 형태는 이름은 남기고 값만 가린다
const ASSIGN = /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*)\s*[=:]\s*\S+/gi;

export function mask(text: string): string {
  let out = text.replace(ASSIGN, "$1=***");
  for (const p of PATTERNS) out = out.replace(p, "***");
  return out;
}
