import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecResult, Sandbox } from "../types.js";
import { runProc } from "../util/proc.js";

export const DEFAULT_IMAGE = "ghost-engineer-sandbox:latest";

export interface DockerOptions {
  image?: string;
  /** Docker network; "none" blocks all egress, "bridge" allows it. */
  network?: string;
  memory?: string;
  cpus?: string;
  /** Env vars passed into the container (e.g. CLAUDE_CODE_OAUTH_TOKEN). Never pass GitHub write tokens. */
  env?: Record<string, string>;
  /** Ports to publish on 127.0.0.1 (for the browser proof step). */
  ports?: number[];
}

/**
 * One container per job. The repo is bind-mounted at /work so the host can
 * read diffs, while agent commands run inside the container.
 */
export class DockerSandbox implements Sandbox {
  readonly trust = "isolated" as const;
  readonly workdir = "/work";
  readonly id = randomUUID().slice(0, 8);
  private constructor(readonly hostWorkdir: string, private readonly container: string) {}

  static async available(): Promise<boolean> {
    const res = await runProc("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 10_000 });
    return res.code === 0;
  }

  static async create(opts: DockerOptions = {}): Promise<DockerSandbox> {
    const root = await mkdtemp(join(tmpdir(), "ghost-"));
    const hostWorkdir = join(root, "repo");
    await runProc("mkdir", ["-p", hostWorkdir]);
    const name = `ghost-${randomUUID().slice(0, 8)}`;
    const envArgs = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const portArgs = (opts.ports ?? []).flatMap((p) => ["-p", `127.0.0.1:${p}:${p}`]);
    const res = await runProc("docker", [
      "run", "-d", "--name", name,
      "--network", opts.network ?? "bridge",
      "--memory", opts.memory ?? "4g",
      "--cpus", opts.cpus ?? "2",
      "--security-opt", "no-new-privileges",
      "-v", `${hostWorkdir}:/work`,
      "-w", "/work",
      ...envArgs,
      ...portArgs,
      opts.image ?? DEFAULT_IMAGE,
      "sleep", "infinity",
    ]);
    if (res.code !== 0) throw new Error(`docker run failed: ${res.stderr}`);
    return new DockerSandbox(hostWorkdir, name);
  }

  exec(command: string, opts: { timeoutMs?: number; env?: Record<string, string> } = {}): Promise<ExecResult> {
    const envArgs = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    return runProc("docker", ["exec", ...envArgs, "-w", "/work", this.container, "bash", "-lc", command], {
      timeoutMs: opts.timeoutMs,
    });
  }

  command(program: string, args: string[]) {
    return { program: "docker", args: ["exec", "-i", "-w", "/work", this.container, program, ...args] };
  }

  async dispose() {
    await runProc("docker", ["rm", "-f", this.container]);
    await rm(join(this.hostWorkdir, ".."), { recursive: true, force: true });
  }
}
