import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeEngine } from "../src/engines/fake.js";
import { prBody, solve } from "../src/pipeline.js";
import { detectRepoConfig } from "../src/repo-config.js";
import { checkoutRepo, LocalSandbox } from "../src/sandbox/index.js";
import { Store } from "../src/store.js";
import type { Issue, Sandbox } from "../src/types.js";
import { ADD_FIX, ADD_TEST, BUGGY_MATH, makeRepo } from "./helpers/repo.js";

let sandbox: Sandbox | undefined;
afterEach(async () => sandbox?.dispose());

async function solveWith(engine: FakeEngine) {
  const store = new Store(":memory:");
  const src = await makeRepo(BUGGY_MATH);
  sandbox = await LocalSandbox.create();
  const baseSha = await checkoutRepo(sandbox, src);
  const runId = store.startRun("issue", "local", engine.name);
  const cfg = { ...detectRepoConfig(sandbox.hostWorkdir), install: undefined };
  const result = await solve({ engine, store, runId, sandbox, baseSha, issue: { title: "add() is off by one", body: "add(2,2) returns 5" }, cfg, log: () => {} });
  return { result, store, runId };
}

describe("solve()", () => {
  it("passes the gate when the agent adds a failing test and a fix", async () => {
    const { result, store, runId } = await solveWith(
      new FakeEngine(async (sb) => {
        await writeFile(join(sb.hostWorkdir, "test/add.test.js"), ADD_TEST);
        await writeFile(join(sb.hostWorkdir, "src/math.js"), ADD_FIX);
        return "SUMMARY: add() added an extra 1; removed it.\nTEST: test/add.test.js";
      }),
    );
    expect(result.outcome).toBe("passed");
    expect(result.summary).toBe("add() added an extra 1; removed it.");
    expect(store.events(runId).map((e) => e.type)).toEqual(expect.arrayContaining(["message", "usage", "done", "gate"]));
    expect(JSON.parse(store.getRun(runId)!.gate_json!).passed).toBe(true);
  });

  it("stops when the agent says the issue isn't a reproducible bug", async () => {
    const { result } = await solveWith(new FakeEngine(async () => "GHOST_SKIP: this is a feature request"));
    expect(result).toMatchObject({ outcome: "agent_skipped", summary: "this is a feature request" });
  });

  it("reports engine errors", async () => {
    const { result } = await solveWith(new FakeEngine(async () => { throw new Error("boom"); }));
    expect(result.outcome).toBe("engine_error");
  });
});

describe("prBody()", () => {
  it("links the issue, shows gate evidence and discloses AI authorship", () => {
    const issue = { owner: "o", repo: "r", number: 7, title: "t" } as Issue;
    const body = prBody({
      issue, engine: "claude", summary: "Fixed it.", gifUrl: "https://x/y.gif", mp4Url: "https://x/y.mp4",
      gate: { passed: true, reason: "passed", testFiles: ["test/a.test.js"], sourceFiles: ["src/a.js"], beforeCode: 1, afterCode: 0, beforeOutput: "FAIL", afterOutput: "ok", patch: "" },
      stats: { durationMs: 120_000, inputTokens: 1000, outputTokens: 500 },
    });
    expect(body).toContain("Fixes #7");
    expect(body).toContain("![Walkthrough of the fix](https://x/y.gif)");
    expect(body).toContain("fails on the original code (exit 1)");
    expect(body).toContain("an AI agent (claude)");
  });
});
