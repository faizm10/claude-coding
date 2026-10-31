import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runProc } from "../../src/util/proc.js";

/** Create a git repo from a map of files and return its path. */
export async function makeRepo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ghost-test-src-"));
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), body);
  }
  const git = (...args: string[]) => runProc("git", ["-C", dir, ...args]);
  await git("init", "-q", "-b", "main");
  await git("add", "-A");
  await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  return dir;
}

/** A tiny JS project whose `add` has an off-by-one bug. */
export const BUGGY_MATH = {
  "package.json": JSON.stringify({ name: "toy", type: "module", scripts: { test: "node --test" } }),
  "src/math.js": "export const add = (a, b) => a + b + 1;\nexport const mul = (a, b) => a * b;\n",
  "test/mul.test.js":
    "import test from 'node:test';\nimport assert from 'node:assert';\nimport { mul } from '../src/math.js';\ntest('mul', () => assert.equal(mul(2, 3), 6));\n",
};

export const ADD_TEST =
  "import test from 'node:test';\nimport assert from 'node:assert';\nimport { add } from '../src/math.js';\ntest('add', () => assert.equal(add(2, 2), 4));\n";
export const ADD_FIX = "export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n";
