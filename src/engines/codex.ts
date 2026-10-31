import type { AgentEvent, Engine, Sandbox, TaskSpec } from "../types.js";
import { RATE_LIMIT_RE, streamProc } from "../util/proc.js";
import { clip } from "../util/text.js";

/** Map one line of `codex exec --json` to normalized events. */
export function parseCodexLine(obj: any): AgentEvent[] {
  const item = obj?.item;
  switch (obj?.type) {
    case "item.started":
      if (item?.type === "command_execution") return [{ type: "tool", name: "shell", input: clip(String(item.command ?? ""), 600) }];
      return [];
    case "item.completed":
      switch (item?.type) {
        case "agent_message":
          return item.text?.trim() ? [{ type: "message", text: item.text }] : [];
        case "command_execution":
          return [{ type: "tool_result", ok: item.exit_code === 0, output: clip(String(item.aggregated_output ?? ""), 1500) }];
        case "file_change":
          return (item.changes ?? []).map((c: any) => ({ type: "file_change", path: String(c.path) }) as AgentEvent);
        case "error":
          return [{ type: "error", message: String(item.message ?? "codex error"), rateLimited: RATE_LIMIT_RE.test(String(item.message)) }];
        default:
          return [];
      }
    case "turn.completed": {
      const u = obj.usage ?? {};
      return [{ type: "usage", inputTokens: u.input_tokens ?? 0, outputTokens: (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0) }];
    }
    case "turn.failed":
    case "error": {
      const message = String(obj.error?.message ?? obj.message ?? "codex failed");
      return [{ type: "error", message, rateLimited: RATE_LIMIT_RE.test(message) }];
    }
    default:
      return [];
  }
}

export class CodexEngine implements Engine {
  readonly name = "codex" as const;

  async *run(task: TaskSpec, sandbox: Sandbox, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const args = [
      "exec", "--json", "--skip-git-repo-check",
      // Reproducible runs: skip the user's config.toml (MCP servers, profiles); auth still works.
      "--ignore-user-config",
      "--ephemeral",
      "-C", sandbox.workdir,
    ];
    // Inside a container Docker is the sandbox; on the host keep Codex's own sandbox on.
    if (sandbox.trust === "isolated") args.push("--dangerously-bypass-approvals-and-sandbox");
    else args.push("-s", "workspace-write");
    if (task.model) args.push("-m", task.model);
    args.push(task.prompt);

    const cmd = sandbox.command("codex", args);
    const started = Date.now();
    let lastMessage = "";
    let failed = false;
    for await (const item of streamProc(cmd.program, cmd.args, {
      timeoutMs: task.maxMinutes * 60_000,
      signal,
      // Only the engine's own auth survives; GitHub tokens etc. are stripped.
      scrub: { keep: ["OPENAI_API_KEY", "CODEX_API_KEY"] },
    })) {
      if (item.kind === "line") {
        let obj: unknown;
        try {
          obj = JSON.parse(item.line);
        } catch {
          continue;
        }
        for (const ev of parseCodexLine(obj)) {
          if (ev.type === "message") lastMessage = ev.text;
          if (ev.type === "error") failed = true;
          yield ev;
        }
      } else {
        const ok = item.code === 0 && !failed && !item.timedOut;
        if (!ok && !failed) {
          const message = item.timedOut ? `timed out after ${task.maxMinutes} min` : item.stderr.trim() || `codex exited ${item.code}`;
          yield { type: "error", message: clip(message, 1500), rateLimited: RATE_LIMIT_RE.test(item.stderr) };
        }
        yield { type: "done", ok, summary: lastMessage, durationMs: Date.now() - started };
      }
    }
  }
}
