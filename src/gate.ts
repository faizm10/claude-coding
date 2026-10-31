import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isTestPath } from "./repo-config.js";
import { hostGit } from "./sandbox/index.js";
import type { Sandbox } from "./types.js";
import { tail } from "./util/text.js";

export type GateReason =
  | "passed"
  | "no_change"
  | "no_test"
  | "no_fix"
  | "test_passed_before_fix"
  | "tests_fail_after_fix"
  | "no_test_command";

export interface GateResult {
  passed: boolean;
  reason: GateReason;
  testFiles: string[];
  sourceFiles: string[];
  /** Exit code of the test command with only the new tests applied (should be non-zero). */
  beforeCode?: number;
  /** Exit code with the full change applied (should be zero). */
  afterCode?: number;
  beforeOutput?: string;
  afterOutput?: string;
  patch: string;
}

/** Everything the agent changed relative to `baseSha`, including new files. */
export async function collectChange(sandbox: Sandbox, baseSha: string) {
  await hostGit(sandbox, ["add", "-A"]);
  const names = await hostGit(sandbox, ["diff", "--cached", "--name-only", baseSha]);
  const patch = await hostGit(sandbox, ["diff", "--cached", "--binary", baseSha]);
  const files = names.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  return { files, patch: patch.stdout };
}

/**
 * The test-first gate: a PR is only allowed when the agent added a test that
 * FAILS on the original code and the full test suite PASSES with its fix.
 * This blocks "fixes" that never reproduced the bug or that broke other tests.
 */
export async function runGate(opts: {
  sandbox: Sandbox;
  baseSha: string;
  testCommand: string;
  testPatterns: string[];
  timeoutMs?: number;
}): Promise<GateResult> {
  const { sandbox, baseSha, testCommand, testPatterns } = opts;
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
  const { files, patch } = await collectChange(sandbox, baseSha);
  const testFiles = files.filter((f) => isTestPath(f, testPatterns));
  const sourceFiles = files.filter((f) => !isTestPath(f, testPatterns));
  const base = { testFiles, sourceFiles, patch };

  if (files.length === 0) return { passed: false, reason: "no_change", ...base };
  if (!testCommand) return { passed: false, reason: "no_test_command", ...base };
  if (testFiles.length === 0) return { passed: false, reason: "no_test", ...base };
  if (sourceFiles.length === 0) return { passed: false, reason: "no_fix", ...base };

  const tmp = await mkdtemp(join(tmpdir(), "ghost-gate-"));
  const patchFile = join(tmp, "full.patch");
  await writeFile(patchFile, patch);
  try {
    // 1) Original code + only the new/changed tests: must FAIL.
    await hostGit(sandbox, ["reset", "--quiet", "--hard", baseSha]);
    await hostGit(sandbox, ["clean", "-fdq"]);
    const applyTests = await hostGit(sandbox, ["apply", ...testFiles.map((f) => `--include=${f}`), patchFile]);
    if (applyTests.code !== 0) throw new Error(`could not apply tests: ${applyTests.stderr}`);
    const before = await sandbox.exec(testCommand, { timeoutMs });

    // 2) Full change: must PASS.
    await hostGit(sandbox, ["reset", "--quiet", "--hard", baseSha]);
    await hostGit(sandbox, ["clean", "-fdq"]);
    const applyAll = await hostGit(sandbox, ["apply", patchFile]);
    if (applyAll.code !== 0) throw new Error(`could not re-apply change: ${applyAll.stderr}`);
    const after = await sandbox.exec(testCommand, { timeoutMs });

    const evidence = {
      beforeCode: before.code,
      afterCode: after.code,
      beforeOutput: tail(before.stdout + before.stderr, 3000),
      afterOutput: tail(after.stdout + after.stderr, 3000),
    };
    if (before.code === 0) return { passed: false, reason: "test_passed_before_fix", ...base, ...evidence };
    if (after.code !== 0) return { passed: false, reason: "tests_fail_after_fix", ...base, ...evidence };
    return { passed: true, reason: "passed", ...base, ...evidence };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
