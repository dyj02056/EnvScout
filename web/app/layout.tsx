// 루트 레이아웃: 한글 UI 글꼴(Pretendard)을 불러온다
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EnvScout",
  description: "내 PC의 저장소·컨테이너·포트·의존성 상태를 채팅으로 점검합니다",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
