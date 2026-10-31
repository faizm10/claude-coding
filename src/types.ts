export type EngineName = "claude" | "codex" | "fake";

/** Normalized stream of what an agent did, independent of which CLI produced it. */
export type AgentEvent =
  | { type: "message"; text: string }
  | { type: "tool"; name: string; input: string }
  | { type: "tool_result"; ok: boolean; output: string }
  | { type: "file_change"; path: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; costUsd?: number }
  | { type: "done"; ok: boolean; summary: string; durationMs: number; turns?: number }
  | { type: "error"; message: string; rateLimited?: boolean; resetsAt?: number }
  /** Plan usage window status (Claude Code reports this; resetsAt is unix seconds). */
  | { type: "rate_limit"; status: string; window?: string; utilization?: number; resetsAt?: number };

export interface TaskSpec {
  prompt: string;
  /** Hard wall-clock limit for the agent session. */
  maxMinutes: number;
  model?: string;
}

/** Where commands run. `isolated` means a container; `local` means a temp clone on the host. */
export interface Sandbox {
  readonly id: string;
  /** Repo path as seen by commands running inside the sandbox. */
  readonly workdir: string;
  /** Repo path on the host (same as workdir for local sandboxes). */
  readonly hostWorkdir: string;
  readonly trust: "isolated" | "local";
  exec(command: string, opts?: { timeoutMs?: number; env?: Record<string, string> }): Promise<ExecResult>;
  /** Extra env for anything running against the repo (e.g. the repo's .venv first on PATH). */
  env(): Record<string, string>;
  /** Wrap a program invocation so it runs inside the sandbox. */
  command(program: string, args: string[]): { program: string; args: string[] };
  dispose(): Promise<void>;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface Engine {
  readonly name: EngineName;
  run(task: TaskSpec, sandbox: Sandbox, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

export interface Issue {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  url: string;
  cloneUrl: string;
  defaultBranch: string;
}
