import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sandbox } from "../types.js";
import { runProc, shq } from "../util/proc.js";
import { DockerSandbox, type DockerOptions } from "./docker.js";
import { LocalSandbox } from "./local.js";

export { DockerSandbox, LocalSandbox };
export type SandboxKind = "auto" | "docker" | "local";

export async function createSandbox(kind: SandboxKind = "auto", docker: DockerOptions = {}): Promise<Sandbox> {
  if (kind === "docker" || (kind === "auto" && (await DockerSandbox.available()))) {
    return DockerSandbox.create(docker);
  }
  if (kind === "auto") {
    process.stderr.write("⚠ Docker not available: using a local temp clone (no isolation). Only run this on repos you trust.\n");
  }
  return LocalSandbox.create();
}

/**
 * Put a repo into the sandbox at `ref`. Cloning happens on the host into the
 * mounted workdir, so the container never needs Git credentials.
 */
export async function checkoutRepo(sandbox: Sandbox, source: string, ref?: string): Promise<string> {
  const clone = await runProc("git", ["clone", "--quiet", "--no-tags", source, sandbox.hostWorkdir], { timeoutMs: 10 * 60_000 });
  if (clone.code !== 0) throw new Error(`git clone failed: ${clone.stderr}`);
  const git = (args: string[]) => runProc("git", ["-C", sandbox.hostWorkdir, ...args]);
  if (ref) {
    const co = await git(["checkout", "--quiet", ref]);
    if (co.code !== 0) {
      await git(["fetch", "--quiet", "origin", ref]);
      const retry = await git(["checkout", "--quiet", ref]);
      if (retry.code !== 0) throw new Error(`git checkout ${ref} failed: ${retry.stderr}`);
    }
  }
  // Keep build artifacts and the proof script out of diffs and commits.
  await runProc("bash", ["-c", `printf 'node_modules/\n.venv/\n__pycache__/\n.pytest_cache/\nghost-proof/\n' >> ${shq(sandbox.hostWorkdir)}/.git/info/exclude`]);
  // Commits made by the harness (never pushed with these identities).
  await git(["config", "user.email", "ghost-engineer@users.noreply.github.com"]);
  await git(["config", "user.name", "Ghost Engineer"]);
  const sha = await git(["rev-parse", "HEAD"]);
  return sha.stdout.trim();
}

export async function hostGit(sandbox: Sandbox, args: string[], input?: string) {
  return runProc("git", ["-C", sandbox.hostWorkdir, ...args], { input });
}

export { shq };

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Turn `fixture:<name>` into a throwaway git repo (so it can be cloned like any
 * other source); local paths are made absolute; URLs pass through.
 */
export async function resolveSource(source: string): Promise<string> {
  if (!source.startsWith("fixture:")) return /^[\w+.-]+:\/\//.test(source) || source.startsWith("git@") ? source : resolve(source);
  const name = source.slice("fixture:".length);
  const dir = await mkdtemp(join(tmpdir(), `ghost-fixture-${name}-`));
  await cp(join(PKG_ROOT, "fixtures", name), dir, { recursive: true });
  const git = (...args: string[]) => runProc("git", ["-C", dir, ...args]);
  await git("init", "-q", "-b", "main");
  await git("add", "-A");
  await git("-c", "user.email=fixture@ghost", "-c", "user.name=fixture", "commit", "-qm", "fixture");
  return dir;
}
