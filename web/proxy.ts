// 모든 /api 요청에 Origin·Host 검사를 건다. 로컬 브라우저에서 온 요청만 통과한다.
import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "@/lib/origin";

export function proxy(req: NextRequest) {
  const reason = checkRequest({
    host: req.headers.get("host"),
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
  });
  if (reason) return NextResponse.json({ error: reason }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
