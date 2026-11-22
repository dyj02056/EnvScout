// port_check: 로컬 포트가 열려 있는지 확인
import net from "node:net";

export function portCheck(port: number): Promise<{ port: number; open: boolean }> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(new Error("포트는 1~65535 사이 정수여야 합니다"));
  }
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port, timeout: 800 });
    const done = (open: boolean) => {
      s.destroy();
      resolve({ port, open });
    };
    s.on("connect", () => done(true));
    s.on("timeout", () => done(false));
    s.on("error", () => done(false));
  });
}
