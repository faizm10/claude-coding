import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGate } from "../src/gate.js";
import { DEFAULT_TEST_PATTERNS } from "../src/repo-config.js";
import { checkoutRepo, LocalSandbox } from "../src/sandbox/index.js";
import type { Sandbox } from "../src/types.js";
import { ADD_FIX, ADD_TEST, BUGGY_MATH, makeRepo } from "./helpers/repo.js";

let sandbox: Sandbox | undefined;
afterEach(async () => sandbox?.dispose());

async function setup(edit: (dir: string) => Promise<void>) {
  const src = await makeRepo(BUGGY_MATH);
  sandbox = await LocalSandbox.create();
  const baseSha = await checkoutRepo(sandbox, src);
  await edit(sandbox.hostWorkdir);
  return runGate({ sandbox, baseSha, testCommand: "npm test --silent", testPatterns: DEFAULT_TEST_PATTERNS });
}

describe("test-first gate", () => {
  it("passes when a new test fails before the fix and everything passes after", async () => {
    const r = await setup(async (d) => {
      await writeFile(join(d, "test/add.test.js"), ADD_TEST);
      await writeFile(join(d, "src/math.js"), ADD_FIX);
    });
    expect(r).toMatchObject({ passed: true, reason: "passed", testFiles: ["test/add.test.js"], sourceFiles: ["src/math.js"] });
    expect(r.beforeCode).not.toBe(0);
    expect(r.afterCode).toBe(0);
  });

  it("rejects a fix with no test", async () => {
    const r = await setup(async (d) => writeFile(join(d, "src/math.js"), ADD_FIX));
    expect(r).toMatchObject({ passed: false, reason: "no_test" });
  });

  it("rejects a test that already passes on the original code", async () => {
    const r = await setup(async (d) => {
      await writeFile(join(d, "test/mul2.test.js"), BUGGY_MATH["test/mul.test.js"]);
      await writeFile(join(d, "src/math.js"), ADD_FIX);
    });
    expect(r).toMatchObject({ passed: false, reason: "test_passed_before_fix" });
  });

  it("rejects a change that breaks other tests", async () => {
    const r = await setup(async (d) => {
      await writeFile(join(d, "test/add.test.js"), ADD_TEST);
      await writeFile(join(d, "src/math.js"), "export const add = (a, b) => a + b;\nexport const mul = () => 0;\n");
    });
    expect(r).toMatchObject({ passed: false, reason: "tests_fail_after_fix" });
  });

  it("reports no change", async () => {
    const r = await setup(async () => {});
    expect(r).toMatchObject({ passed: false, reason: "no_change" });
  });
});
