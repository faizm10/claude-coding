import { afterEach, describe, expect, it } from "vitest";
import { LocalSandbox } from "../src/sandbox/index.js";
import { scrubbedEnv } from "../src/util/proc.js";

describe("secret scrubbing", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("drops credentials but keeps ordinary variables and allowed keys", () => {
    process.env.GH_TOKEN = "ghp_secret";
    process.env.GITHUB_TOKEN = "x";
    process.env.AWS_SECRET_ACCESS_KEY = "x";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "keep-me";
    const env = scrubbedEnv(["CLAUDE_CODE_OAUTH_TOKEN"]);
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("keep-me");
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("repo commands in the local sandbox cannot read the GitHub token", async () => {
    process.env.GH_TOKEN = "ghp_should_not_leak";
    const sb = await LocalSandbox.create();
    await (await import("node:fs/promises")).mkdir(sb.hostWorkdir, { recursive: true });
    const r = await sb.exec('echo "token=${GH_TOKEN:-none}"');
    await sb.dispose();
    expect(r.stdout.trim()).toBe("token=none");
  });
});
