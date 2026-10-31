import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ExecResult } from "../types.js";

export interface ProcOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Start from a secret-free copy of process.env (for agent and repo code). */
  scrub?: { keep?: string[] };
  timeoutMs?: number;
  input?: string;
  signal?: AbortSignal;
}

const MAX_CAPTURE = 2_000_000;

/** Run a program to completion and capture its output (truncated to keep memory bounded). */
const SECRET_RE = /(^GH_|^GITHUB_|TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|^AWS_|^NPM_AUTH|SESSION)/i;

/**
 * process.env minus anything that looks like a credential. Agents and the
 * repo's own test code run with this, so a prompt-injected agent or a
 * malicious test can't read e.g. the GitHub token used to open PRs.
 */
export function scrubbedEnv(keep: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SECRET_RE.test(k) && !keep.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function childEnv(opts: ProcOptions): NodeJS.ProcessEnv {
  const base = opts.scrub ? scrubbedEnv(opts.scrub.keep) : process.env;
  return { ...base, ...opts.env };
}

export function runProc(program: string, args: string[], opts: ProcOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(program, args, {
      cwd: opts.cwd,
      env: childEnv(opts),
      stdio: ["pipe", "pipe", "pipe"],
      signal: opts.signal,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;
    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_CAPTURE) stdout += d;
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_CAPTURE) stderr += d;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export type StreamItem = { kind: "line"; line: string } | { kind: "exit"; code: number; stderr: string; timedOut: boolean };

/** Run a program and yield its stdout line by line, then a final exit record. */
export async function* streamProc(program: string, args: string[], opts: ProcOptions = {}): AsyncGenerator<StreamItem> {
  const child = spawn(program, args, {
    cwd: opts.cwd,
    env: childEnv(opts),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let timedOut = false;
  const kill = () => child.kill("SIGKILL");
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        kill();
      }, opts.timeoutMs)
    : undefined;
  opts.signal?.addEventListener("abort", kill, { once: true });
  child.stderr.on("data", (d) => {
    if (stderr.length < MAX_CAPTURE) stderr += d;
  });
  const exited = new Promise<number>((resolve) => {
    child.on("error", (err) => {
      stderr += String(err);
      resolve(127);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (opts.input !== undefined) child.stdin.end(opts.input);
  else child.stdin.end();

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield { kind: "line", line };
  }
  const code = await exited;
  clearTimeout(timer);
  opts.signal?.removeEventListener("abort", kill);
  yield { kind: "exit", code, stderr, timedOut };
}

/** Single-quote a string for bash. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export const RATE_LIMIT_RE = /usage limit|rate[ -]?limit|limit reached|too many requests|\b429\b|quota/i;
