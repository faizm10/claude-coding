import type { AgentEvent, Engine, Sandbox, TaskSpec } from "../types.js";
import { RATE_LIMIT_RE, streamProc } from "../util/proc.js";
import { clip } from "../util/text.js";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Tools the agent may use when the sandbox is only a temp clone on the host. */
const LOCAL_ALLOWED_TOOLS = [
  "Read", "Edit", "Write", "MultiEdit", "Glob", "Grep", "LS",
  "Bash(npm *)", "Bash(npx *)", "Bash(node *)", "Bash(pnpm *)", "Bash(yarn *)",
  "Bash(python *)", "Bash(python3 *)", "Bash(pytest *)", "Bash(pip *)",
  "Bash(go test *)", "Bash(cargo test *)", "Bash(git diff *)", "Bash(git status *)",
  "Bash(git log *)", "Bash(ls *)", "Bash(cat *)", "Bash(grep *)", "Bash(rg *)", "Bash(find *)",
];

/** Map one line of `claude -p --output-format stream-json` to normalized events. */
export function parseClaudeLine(obj: any): AgentEvent[] {
  switch (obj?.type) {
    case "assistant": {
      const out: AgentEvent[] = [];
      for (const c of obj.message?.content ?? []) {
        if (c.type === "text" && c.text?.trim()) out.push({ type: "message", text: c.text });
        if (c.type === "tool_use") {
          out.push({ type: "tool", name: c.name, input: clip(JSON.stringify(c.input ?? {}), 600) });
          if (EDIT_TOOLS.has(c.name) && c.input?.file_path) out.push({ type: "file_change", path: c.input.file_path });
        }
      }
      return out;
    }
    case "user": {
      const out: AgentEvent[] = [];
      for (const c of obj.message?.content ?? []) {
        if (c?.type !== "tool_result") continue;
        const text = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
        out.push({ type: "tool_result", ok: !c.is_error, output: clip(text, 1500) });
      }
      return out;
    }
    case "rate_limit_event": {
      const info = obj.rate_limit_info ?? {};
      const window = info.rateLimitType as string | undefined;
      const util = window ? info.unifiedWindows?.[window]?.utilization : undefined;
      return [{ type: "rate_limit", status: String(info.status ?? "unknown"), window, utilization: util, resetsAt: info.resetsAt }];
    }
    case "result": {
      const u = obj.usage ?? {};
      const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      const ok = obj.subtype === "success" && !obj.is_error;
      const summary = String(obj.result ?? "");
      const events: AgentEvent[] = [
        { type: "usage", inputTokens: input, outputTokens: u.output_tokens ?? 0, costUsd: obj.total_cost_usd },
      ];
      if (!ok && RATE_LIMIT_RE.test(summary)) events.push({ type: "error", message: summary, rateLimited: true });
      events.push({ type: "done", ok, summary, durationMs: obj.duration_ms ?? 0, turns: obj.num_turns });
      return events;
    }
    default:
      return [];
  }
}

export class ClaudeCodeEngine implements Engine {
  readonly name = "claude" as const;

  async *run(task: TaskSpec, sandbox: Sandbox, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const args = [
      "-p", task.prompt,
      "--output-format", "stream-json", "--verbose",
      // Reproducible runs: ignore the user's personal hooks, plugins and MCP servers.
      "--setting-sources", "project",
      "--strict-mcp-config",
      "--no-session-persistence",
    ];
    if (sandbox.trust === "isolated") args.push("--dangerously-skip-permissions");
    else args.push("--permission-mode", "acceptEdits", "--allowedTools", LOCAL_ALLOWED_TOOLS.join(" "));
    if (task.model) args.push("--model", task.model);

    const cmd = sandbox.command("claude", args);
    let sawDone = false;
    for await (const item of streamProc(cmd.program, cmd.args, {
      cwd: sandbox.trust === "local" ? sandbox.hostWorkdir : undefined,
      timeoutMs: task.maxMinutes * 60_000,
      signal,
    })) {
      if (item.kind === "line") {
        let obj: unknown;
        try {
          obj = JSON.parse(item.line);
        } catch {
          continue;
        }
        for (const ev of parseClaudeLine(obj)) {
          if (ev.type === "done") sawDone = true;
          yield ev;
        }
      } else if (!sawDone) {
        const message = item.timedOut ? `timed out after ${task.maxMinutes} min` : item.stderr.trim() || `claude exited ${item.code}`;
        yield { type: "error", message: clip(message, 1500), rateLimited: RATE_LIMIT_RE.test(item.stderr) };
        yield { type: "done", ok: false, summary: message, durationMs: 0 };
      }
    }
  }
}
