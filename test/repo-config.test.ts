import { describe, expect, it } from "vitest";
import { DEFAULT_TEST_PATTERNS, detectRepoConfig, isTestPath } from "../src/repo-config.js";
import { BUGGY_MATH, makeRepo } from "./helpers/repo.js";

describe("repo config", () => {
  it("detects npm projects", async () => {
    const dir = await makeRepo(BUGGY_MATH);
    expect(detectRepoConfig(dir)).toMatchObject({ install: "npm install", test: "npm test", maxMinutes: 30 });
  });

  it("lets .ghost.json override detection", async () => {
    const dir = await makeRepo({ ...BUGGY_MATH, ".ghost.json": JSON.stringify({ test: "npx vitest run", maxMinutes: 10 }) });
    expect(detectRepoConfig(dir)).toMatchObject({ test: "npx vitest run", maxMinutes: 10 });
  });

  it.each([
    ["test/a.test.js", true], ["src/__tests__/x.ts", true], ["pkg/foo_test.go", true],
    ["tests/test_api.py", true], ["src/app.test.tsx", true], ["src/math.js", false], ["README.md", false],
  ])("isTestPath(%s) = %s", (path, expected) => {
    expect(isTestPath(path, DEFAULT_TEST_PATTERNS)).toBe(expected);
  });
});
