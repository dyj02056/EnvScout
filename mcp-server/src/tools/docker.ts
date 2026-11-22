// docker_ps: 실행 중인 컨테이너와 포트
import { run } from "../safe.js";

/** docker ps --format {{json .}} 출력(한 줄에 JSON 하나)을 해석한다. */
export function parseDockerPs(stdout: string) {
  const containers = stdout
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, string>)
    .map((c) => ({ name: c.Names, image: c.Image, ports: c.Ports, status: c.Status }));
  return { count: containers.length, containers };
}

export async function dockerPs() {
  const r = await run("docker", ["ps", "--format", "{{json .}}"], { timeout: 8000 });
  if (r.code !== 0) throw new Error("Docker 엔진이 꺼져 있습니다. Docker Desktop을 실행한 뒤 다시 시도하세요.");
  return parseDockerPs(r.stdout);
}
