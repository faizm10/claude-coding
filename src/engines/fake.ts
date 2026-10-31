import type { AgentEvent, Engine, Sandbox, TaskSpec } from "../types.js";

export type FakeScript = (sandbox: Sandbox, task: TaskSpec) => Promise<string | void>;

/**
 * Deterministic engine for tests and demos: runs a scripted edit instead of a model.
 * The script's return value becomes the session summary.
 */
export class FakeEngine implements Engine {
  readonly name = "fake" as const;
  constructor(private readonly script: FakeScript) {}

  async *run(task: TaskSpec, sandbox: Sandbox): AsyncIterable<AgentEvent> {
    const started = Date.now();
    yield { type: "message", text: "fake engine: applying scripted change" };
    try {
      const summary = (await this.script(sandbox, task)) ?? "SUMMARY: scripted change applied";
      yield { type: "usage", inputTokens: 0, outputTokens: 0, costUsd: 0 };
      yield { type: "done", ok: true, summary, durationMs: Date.now() - started, turns: 1 };
    } catch (err) {
      yield { type: "error", message: String(err) };
      yield { type: "done", ok: false, summary: String(err), durationMs: Date.now() - started };
    }
  }
}
