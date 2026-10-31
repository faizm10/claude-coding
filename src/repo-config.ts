import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Optional `.ghost.json` in the target repo; everything is auto-detected when absent. */
export interface RepoConfig {
  install?: string;
  test: string;
  /** Regex sources; a changed path matching any of these counts as a test file. */
  testPatterns: string[];
  /** Browser proof: how to start the app and where it serves. */
  prove?: { start: string; url: string; readyTimeoutSec?: number };
  /** Minutes the agent may spend on one issue. */
  maxMinutes: number;
}

export const DEFAULT_TEST_PATTERNS = [
  String.raw`(^|/)(tests?|__tests__|spec|specs)/`,
  String.raw`\.(test|spec)\.[cm]?[jt]sx?$`,
  String.raw`(^|/)test_[^/]+\.py$`,
  String.raw`_test\.(py|go)$`,
  String.raw`(^|/)tests?\.rs$`,
];

export function detectRepoConfig(dir: string): RepoConfig {
  const file = join(dir, ".ghost.json");
  const user: Partial<RepoConfig> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const has = (f: string) => existsSync(join(dir, f));

  let install: string | undefined;
  let test = "";
  if (has("package.json")) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    install = has("pnpm-lock.yaml") ? "pnpm install --frozen-lockfile" : has("yarn.lock") ? "yarn install --frozen-lockfile" : has("package-lock.json") ? "npm ci" : "npm install";
    if (pkg.scripts?.test && !/no test specified/.test(pkg.scripts.test)) test = "npm test";
  } else if (has("pyproject.toml") || has("setup.py") || has("requirements.txt")) {
    install = has("requirements.txt") ? "pip install -r requirements.txt" : "pip install -e .";
    test = "python -m pytest -q";
  } else if (has("go.mod")) {
    test = "go test ./...";
  } else if (has("Cargo.toml")) {
    test = "cargo test";
  }

  return {
    install: user.install ?? install,
    test: user.test ?? test,
    testPatterns: user.testPatterns ?? DEFAULT_TEST_PATTERNS,
    prove: user.prove,
    maxMinutes: user.maxMinutes ?? 30,
  };
}

export function isTestPath(path: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p).test(path));
}
