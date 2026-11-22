// port_check: 로컬 포트가 열려 있는지 확인 (IPv4 127.0.0.1과 IPv6 ::1 모두)
import net from "node:net";

function probe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 800 });
    const done = (open: boolean) => {
      s.destroy();
      resolve(open);
    };
    s.on("connect", () => done(true));
    s.on("timeout", () => done(false));
    s.on("error", () => done(false));
  });
}

export async function portCheck(port: number): Promise<{ port: number; open: boolean; ipv4: boolean; ipv6: boolean }> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("포트는 1~65535 사이 정수여야 합니다");
  }
  // localhost가 ::1로만 열리는 서버(Node 17+, Vite 등)도 잡으려고 둘 다 확인한다
  const [ipv4, ipv6] = await Promise.all([probe("127.0.0.1", port), probe("::1", port)]);
  return { port, open: ipv4 || ipv6, ipv4, ipv6 };
}
