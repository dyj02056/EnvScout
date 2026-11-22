// 로컬 요청만 통과시키는 검사. 다른 사이트에서 보낸 요청(CSRF)과 DNS 리바인딩을 막는다.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function extra(): Set<string> {
  // ENVSCOUT_ALLOWED_ORIGINS=http://mybox:3000,https://dev.example.test 처럼 쉼표로 구분
  const raw = process.env.ENVSCOUT_ALLOWED_ORIGINS ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => new URL(s).host));
}

function hostOk(host: string, allowed: Set<string>): boolean {
  if (allowed.has(host)) return true;
  // host:port 에서 포트를 뗀다. IPv6는 [::1]:3000 형태.
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return LOCAL_HOSTS.has(name.toLowerCase());
}

/** 거부 사유를 돌려준다. 통과면 null. */
export function checkRequest(h: { host: string | null; origin: string | null; secFetchSite: string | null }): string | null {
  const allowed = extra();
  if (!h.host || !hostOk(h.host, allowed)) return "허용되지 않은 Host입니다";
  if (h.secFetchSite === "cross-site") return "다른 사이트에서 보낸 요청은 받지 않습니다";
  if (h.origin && h.origin !== "null") {
    let originHost: string;
    try {
      originHost = new URL(h.origin).host;
    } catch {
      return "잘못된 Origin입니다";
    }
    if (!hostOk(originHost, allowed)) return "허용되지 않은 Origin입니다";
  } else if (h.origin === "null") {
    return "허용되지 않은 Origin입니다";
  }
  return null;
}
