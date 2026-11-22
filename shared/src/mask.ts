// 도구 출력과 로그에서 비밀값을 가리는 함수. mcp-server와 web이 함께 쓴다.
const PATTERNS: RegExp[] = [
  /gsk_[A-Za-z0-9]{20,}/g, // Groq 키
  /postgres(?:ql)?:\/\/[^\s"'\\]+/gi, // Neon 연결 문자열(비밀번호 포함)
  /sk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic 키
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI류 키
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub 토큰
  /AKIA[0-9A-Z]{16}/g, // AWS 액세스 키
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

const SECRET_NAME = "[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Za-z0-9_]*";
// KEY=값 / KEY: 값 형태는 이름은 남기고 값만 가린다.
// 값은 따옴표로 감싼 문자열이거나, 공백·따옴표·쉼표·닫는 괄호 전까지다(JSON 구조를 먹지 않게).
// JSON으로 직렬화된 텍스트 안에서는 따옴표가 \" 로 이스케이프되어 있으므로 그 형태도 처리한다.
const ASSIGN = new RegExp(
  `\\b(${SECRET_NAME})(\\s*[=:]\\s*)(?:\\\\"[^"\\\\\\n]*\\\\"|"[^"\\n]*"|'[^'\\n]*'|[^\\s"',}\\]\\\\]+)`,
  "gi",
);
// JSON 텍스트 안의 "apiKey": "값"
const JSON_PAIR = new RegExp(`"(${SECRET_NAME})"(\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, "gi");
const SECRET_KEY = new RegExp(`^${SECRET_NAME}$`, "i");

export function mask(text: string): string {
  let out = text.replace(JSON_PAIR, '"$1"$2"***"').replace(ASSIGN, "$1$2***");
  for (const p of PATTERNS) out = out.replace(p, "***");
  return out;
}

/** 객체를 돌면서 문자열만 가린다. 비밀스러운 이름의 키는 값 전체를 가린다. 구조는 그대로 둔다. */
export function maskDeep<T>(value: T): T {
  return walk(value, undefined) as T;
}

function walk(v: unknown, key: string | undefined): unknown {
  if (typeof v === "string") return key && SECRET_KEY.test(key) ? "***" : mask(v);
  if (Array.isArray(v)) return v.map((x) => walk(x, undefined));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
  }
  return v;
}
