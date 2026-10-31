import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine } from "./engines/index.js";
import { solve, type Logger, type Outcome } from "./pipeline.js";
import { detectRepoConfig } from "./repo-config.js";
import { checkoutRepo, createSandbox, hostGit, type SandboxKind } from "./sandbox/index.js";
import { ghostHome, type RunRow, type Store } from "./store.js";
import type { Engine, EngineName } from "./types.js";
import { runProc } from "./util/proc.js";
import { clip, tail } from "./util/text.js";

export interface EvalTask {
  id: string;
  /** Git URL, local path, or `fixture:<name>` (a folder under fixtures/). */
  repo: string;
  baseCommit?: string;
  title: string;
  body: string;
  install?: string;
  /** Test command the agent/gate uses; auto-detected when omitted. */
  test?: string;
  /** Hidden tests the agent never sees, written before grading. */
  hiddenTests?: Record<string, string>;
  /** Unified diff of hidden tests (SWE-bench style), applied before grading. */
  testPatch?: string;
  /** Grading command; exit code 0 means the task is resolved. */
  grade: string;
  maxMinutes?: number;
  tags?: string[];
}

export interface Suite {
  name: string;
  description?: string;
  tasks: EvalTask[];
}

export type EvalOutcome = Outcome | "resolved" | "wrong_fix";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function loadSuite(path: string): Promise<Suite> {
  return JSON.parse(await readFile(path, "utf8")) as Suite;
}

/** Turn a fixture folder into a throwaway git repo so it can be cloned like any other. */
async function materializeFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `ghost-fixture-${name}-`));
  await cp(join(PKG_ROOT, "fixtures", name), dir, { recursive: true });
  const git = (...args: string[]) => runProc("git", ["-C", dir, ...args]);
  await git("init", "-q", "-b", "main");
  await git("add", "-A");
  await git("-c", "user.email=fixture@ghost", "-c", "user.name=fixture", "commit", "-qm", "fixture");
  return dir;
}

/** Write hidden tests onto the agent's final code and run the grader. */
async function grade(sandbox: Awaited<ReturnType<typeof createSandbox>>, task: EvalTask, baseSha: string) {
  if (task.testPatch) {
    // Hidden tests win over any edits the agent made to the same files.
    const files = [...task.testPatch.matchAll(/^diff --git a\/(\S+) b\//gm)].map((m) => m[1]);
    for (const f of files) {
      const existed = (await hostGit(sandbox, ["cat-file", "-e", `${baseSha}:${f}`])).code === 0;
      if (existed) await hostGit(sandbox, ["checkout", baseSha, "--", f]);
      else await runProc("rm", ["-f", join(sandbox.hostWorkdir, f)]);
    }
    const applied = await hostGit(sandbox, ["apply", "-"], task.testPatch);
    if (applied.code !== 0) return { resolved: false, output: `could not apply hidden test patch: ${applied.stderr}` };
  }
  for (const [path, body] of Object.entries(task.hiddenTests ?? {})) {
    await mkdir(dirname(join(sandbox.hostWorkdir, path)), { recursive: true });
    await writeFile(join(sandbox.hostWorkdir, path), body);
  }
  const res = await sandbox.exec(task.grade, { timeoutMs: 20 * 60_000 });
  return { resolved: res.code === 0, output: tail(res.stdout + res.stderr, 3000) };
}

export async function runTask(o: { task: EvalTask; suite: string; engine: Engine; store: Store; sandboxKind?: SandboxKind; model?: string; log: Logger }) {
  const { task, store, engine, log } = o;
  const runId = store.startRun("eval", task.id, engine.name, o.suite);
  const started = Date.now();
  const sandbox = await createSandbox(o.sandboxKind);
  try {
    const source = task.repo.startsWith("fixture:") ? await materializeFixture(task.repo.slice(8)) : task.repo;
    const baseSha = await checkoutRepo(sandbox, source, task.baseCommit);
    const detected = detectRepoConfig(sandbox.hostWorkdir);
    const cfg = {
      ...detected,
      install: task.install ?? detected.install,
      test: task.test ?? detected.test,
      maxMinutes: task.maxMinutes ?? detected.maxMinutes,
      prove: undefined,
    };
    const result = await solve({ engine, store, runId, sandbox, baseSha, issue: { title: task.title, body: task.body, ref: task.id }, cfg, model: o.model, log });

    let outcome: EvalOutcome = result.outcome;
    let resolved = false;
    if (!["env_setup", "rate_limited", "engine_error", "timeout"].includes(result.outcome)) {
      store.setPhase(runId, "grade");
      const g = await grade(sandbox, task, baseSha);
      resolved = g.resolved;
      store.addEvent(runId, "grade", { type: "grade", resolved, output: g.output });
      if (resolved) outcome = "resolved";
      else if (result.outcome === "passed") outcome = "wrong_fix";
    }
    store.finish(runId, resolved ? "succeeded" : "failed", { outcome, resolved: resolved ? 1 : 0, summary: clip(result.summary, 500), duration_ms: Date.now() - started });
    log(`  ${resolved ? "✅" : "❌"} ${task.id} [${engine.name}] → ${outcome}`);
    return { runId, outcome, resolved, rateLimitResetsAt: result.rateLimitResetsAt };
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    store.finish(runId, "failed", { outcome: "engine_error", resolved: 0, summary: clip(message, 500), duration_ms: Date.now() - started });
    log(`  ✖ ${task.id} [${engine.name}] → ${message}`);
    return { runId, outcome: "engine_error" as EvalOutcome, resolved: false };
  } finally {
    await sandbox.dispose();
  }
}

/** Run every task on every engine (sequentially: one subscription, one job at a time). */
export async function runSuite(o: {
  suite: Suite;
  engines: EngineName[];
  store: Store;
  sandboxKind?: SandboxKind;
  model?: string;
  filter?: (t: EvalTask) => boolean;
  engineFactory?: (name: EngineName) => Engine;
  log?: Logger;
}) {
  const log = o.log ?? (() => {});
  const make = o.engineFactory ?? createEngine;
  const tasks = o.suite.tasks.filter(o.filter ?? (() => true));
  for (const name of o.engines) {
    log(`\n▶ ${o.suite.name}: ${tasks.length} tasks on ${name}`);
    const engine = make(name);
    for (const task of tasks) {
      const r = await runTask({ task, suite: o.suite.name, engine, store: o.store, sandboxKind: o.sandboxKind, model: o.model, log });
      if (r.outcome === "rate_limited") {
        log(`⏸ plan limit reached${r.rateLimitResetsAt ? ` (resets ${new Date(r.rateLimitResetsAt).toLocaleString()})` : ""}; stopping. Re-run later with --resume.`);
        return;
      }
    }
  }
}

// ---------------- reporting ----------------

export interface EngineReport {
  engine: string;
  tasks: number;
  resolved: number;
  resolveRate: number;
  gatePassRate: number;
  medianMinutes: number;
  p95Minutes: number;
  avgTokens: number;
  costUsd: number;
  outcomes: Record<string, number>;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** Latest run per (task, engine) wins, so re-runs replace earlier attempts. */
export function latestRuns(runs: RunRow[]): RunRow[] {
  const byKey = new Map<string, RunRow>();
  for (const r of [...runs].sort((a, b) => a.id - b.id)) {
    if (r.status === "running") continue;
    byKey.set(`${r.target}::${r.engine}`, r);
  }
  return [...byKey.values()];
}

export function buildReport(runs: RunRow[]): EngineReport[] {
  const groups = new Map<string, RunRow[]>();
  for (const r of latestRuns(runs)) groups.set(r.engine, [...(groups.get(r.engine) ?? []), r]);
  return [...groups.entries()].map(([engine, rs]) => {
    const minutes = rs.map((r) => (r.duration_ms ?? 0) / 60000).sort((a, b) => a - b);
    const outcomes: Record<string, number> = {};
    for (const r of rs) outcomes[r.outcome ?? "unknown"] = (outcomes[r.outcome ?? "unknown"] ?? 0) + 1;
    const resolved = rs.filter((r) => r.resolved === 1).length;
    const gatePassed = rs.filter((r) => r.outcome === "resolved" || r.outcome === "wrong_fix" || r.outcome === "passed").length;
    return {
      engine,
      tasks: rs.length,
      resolved,
      resolveRate: rs.length ? resolved / rs.length : 0,
      gatePassRate: rs.length ? gatePassed / rs.length : 0,
      medianMinutes: percentile(minutes, 50),
      p95Minutes: percentile(minutes, 95),
      avgTokens: rs.length ? rs.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0) / rs.length : 0,
      costUsd: rs.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
      outcomes,
    };
  });
}

export function reportMarkdown(suite: string, report: EngineReport[]): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const rows = report
    .map((r) => `| ${r.engine} | ${r.resolved}/${r.tasks} | **${pct(r.resolveRate)}** | ${pct(r.gatePassRate)} | ${r.medianMinutes.toFixed(1)} | ${r.p95Minutes.toFixed(1)} | ${Math.round(r.avgTokens).toLocaleString("en-US")} | $${r.costUsd.toFixed(2)} |`)
    .join("\n");
  const outcomeKeys = [...new Set(report.flatMap((r) => Object.keys(r.outcomes)))].sort();
  const outcomeRows = outcomeKeys.map((k) => `| ${k} | ${report.map((r) => r.outcomes[k] ?? 0).join(" | ")} |`).join("\n");
  return `# Eval: ${suite}

| Engine | Resolved | Resolve rate | Gate pass | Median min | p95 min | Avg tokens | Cost* |
|---|---|---|---|---|---|---|---|
${rows}

\\* Claude Code reports an API-equivalent cost; on a subscription plan you are not billed this amount. Codex does not report cost.

## Failure breakdown
| Outcome | ${report.map((r) => r.engine).join(" | ")} |
|---|${report.map(() => "---").join("|")}|
${outcomeRows}
`;
}

export async function writeReport(store: Store, suite: string): Promise<{ md: string; mdPath: string; jsonPath: string }> {
  const report = buildReport(store.listRuns({ kind: "eval", suite, limit: 100_000 }));
  const md = reportMarkdown(suite, report);
  const dir = join(ghostHome(), "evals");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = join(dir, `${suite.replace(/[^\w.-]+/g, "_")}-${stamp}`);
  await writeFile(`${base}.md`, md);
  await writeFile(`${base}.json`, JSON.stringify(report, null, 2));
  return { md, mdPath: `${base}.md`, jsonPath: `${base}.json` };
}
