import { readFile } from "node:fs/promises";
import type { Engine, EngineName } from "../types.js";
import { runProc } from "../util/proc.js";
import { ClaudeCodeEngine } from "./claude.js";
import { CodexEngine } from "./codex.js";
import { FakeEngine } from "./fake.js";

export { ClaudeCodeEngine, CodexEngine, FakeEngine };

export function createEngine(name: EngineName): Engine {
  switch (name) {
    case "claude":
      return new ClaudeCodeEngine();
    case "codex":
      return new CodexEngine();
    case "fake": {
      // CLI demo mode: apply the patch named by GHOST_FAKE_PATCH.
      const patch = process.env.GHOST_FAKE_PATCH;
      return new FakeEngine(async (sandbox) => {
        if (!patch) throw new Error("set GHOST_FAKE_PATCH to a patch file for the fake engine");
        const body = await readFile(patch, "utf8");
        const res = await runProc("git", ["apply", "-"], { cwd: sandbox.hostWorkdir, input: body });
        if (res.code !== 0) throw new Error(`git apply failed: ${res.stderr}`);
      });
    }
    default:
      throw new Error(`unknown engine: ${name satisfies never}`);
  }
}

export function isEngineName(v: string): v is EngineName {
  return v === "claude" || v === "codex" || v === "fake";
}
