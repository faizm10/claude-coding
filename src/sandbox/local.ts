import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecResult, Sandbox } from "../types.js";
import { runProc } from "../util/proc.js";

/**
 * A throwaway clone on the host. Fine for your own trusted repos; it does NOT
 * isolate the agent from your machine. Use DockerSandbox for anything else.
 */
export class LocalSandbox implements Sandbox {
  readonly trust = "local" as const;
  readonly id = randomUUID().slice(0, 8);
  private constructor(readonly hostWorkdir: string) {}

  get workdir() {
    return this.hostWorkdir;
  }

  static async create(): Promise<LocalSandbox> {
    const root = await mkdtemp(join(tmpdir(), "ghost-"));
    return new LocalSandbox(join(root, "repo"));
  }

  exec(command: string, opts: { timeoutMs?: number; env?: Record<string, string> } = {}): Promise<ExecResult> {
    // Non-login shell: inherit the caller's PATH/toolchain instead of re-reading profiles.
    return runProc("bash", ["-c", command], { cwd: this.hostWorkdir, timeoutMs: opts.timeoutMs, env: opts.env });
  }

  command(program: string, args: string[]) {
    return { program, args };
  }

  async dispose() {
    await rm(join(this.hostWorkdir, ".."), { recursive: true, force: true });
  }
}
