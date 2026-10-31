import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseClaudeLine } from "../src/engines/claude.js";
import { parseCodexLine } from "../src/engines/codex.js";
import type { AgentEvent } from "../src/types.js";

const load = (f: string) =>
  readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("parseClaudeLine (real captured stream)", () => {
  const events: AgentEvent[] = load("claude-stream.jsonl").flatMap(parseClaudeLine);

  it("reports the Write tool call and the file it changed", () => {
    expect(events).toContainEqual(expect.objectContaining({ type: "tool", name: "Write" }));
    expect(events).toContainEqual({ type: "file_change", path: "/work/repo/b.txt" });
  });

  it("captures plan usage windows", () => {
    expect(events).toContainEqual(expect.objectContaining({ type: "rate_limit", status: "allowed", window: "five_hour" }));
  });

  it("ends with usage and a successful done event", () => {
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({ type: "usage", outputTokens: expect.any(Number) });
    expect(events.at(-1)).toMatchObject({ type: "done", ok: true, summary: "DONE", turns: 2 });
  });

  it("flags rate-limited failures", () => {
    const evs = parseClaudeLine({ type: "result", subtype: "error_during_execution", is_error: true, result: "Claude usage limit reached", usage: {} });
    expect(evs).toContainEqual(expect.objectContaining({ type: "error", rateLimited: true }));
    expect(evs.at(-1)).toMatchObject({ type: "done", ok: false });
  });
});

describe("parseCodexLine (real captured stream)", () => {
  const events: AgentEvent[] = load("codex-stream.jsonl").flatMap(parseCodexLine);

  it("maps shell commands to tool + tool_result", () => {
    expect(events).toContainEqual(expect.objectContaining({ type: "tool", name: "shell" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_result", ok: true, output: "ok" }));
  });

  it("keeps agent messages and usage", () => {
    expect(events).toContainEqual({ type: "message", text: "DONE" });
    expect(events.find((e) => e.type === "usage")).toMatchObject({ inputTokens: expect.any(Number) });
  });

  it("maps file changes and failures", () => {
    expect(parseCodexLine({ type: "item.completed", item: { type: "file_change", changes: [{ path: "src/a.ts", kind: "update" }] } }))
      .toEqual([{ type: "file_change", path: "src/a.ts" }]);
    expect(parseCodexLine({ type: "turn.failed", error: { message: "You've hit your usage limit" } }))
      .toEqual([{ type: "error", message: "You've hit your usage limit", rateLimited: true }]);
  });
});
