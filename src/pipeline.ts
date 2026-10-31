import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runGate, type GateResult } from "./gate.js";
import { canPush, createPullRequest, ensureFork, fetchIssue, fetchRepoFile, uploadMedia } from "./github.js";
import { fileBase64, narrate, narrationText, recordProof, renderMedia, startApp, waitForUrl } from "./proof.js";
import { fixPrompt, parseOutcome, proofPrompt, type IssueInput } from "./prompts.js";
import { detectRepoConfig, type RepoConfig } from "./repo-config.js";
import { checkoutRepo, createSandbox, hostGit, resolveSource, type SandboxKind } from "./sandbox/index.js";
import { ghostHome, type Store } from "./store.js";
import type { AgentEvent, Engine, Issue, Sandbox } from "./types.js";
import { runProc } from "./util/proc.js";
import { clip, tail } from "./util/text.js";

export type Outcome =
  | GateResult["reason"]
  | "rate_limited"
  | "engine_error"
  | "timeout"
  | "env_setup"
  | "agent_skipped"
  | "triage_rejected";

export interface SolveResult {
  outcome: Outcome;
  summary: string;
  gate?: GateResult;
  rateLimitResetsAt?: number; // unix ms
}

export type Logger = (line: string) => void;

/** Stream an engine session into the store; returns what the agent concluded. */
async function runAgent(engine: Engine, prompt: string, sandbox: Sandbox, store: Store, runId: number, phase: string, maxMinutes: number, model?: string) {
  let ok = false;
  let text = "";
  let error = "";
  let rateLimited = false;
  let resetsAt: number | undefined;
  for await (const ev of engine.run({ prompt, maxMinutes, model }, sandbox)) {
    store.addEvent(runId, phase, ev);
    if (ev.type === "message") text += `${ev.text}\n`;
    if (ev.type === "rate_limit" && ev.status !== "allowed") {
      rateLimited = true;
      resetsAt = ev.resetsAt ? ev.resetsAt * 1000 : undefined;
    }
    if (ev.type === "error") {
      error = ev.message;
      if (ev.rateLimited) rateLimited = true;
    }
    if (ev.type === "done") {
      ok = ev.ok;
      if (ev.summary) text += `${ev.summary}\n`;
    }
  }
  return { ok, text, error, rateLimited, resetsAt };
}

/**
 * The shared core used by both real issues and benchmark tasks:
 * install → agent writes failing test + fix → test-first gate.
 */
export async function solve(o: {
  engine: Engine;
  store: Store;
  runId: number;
  sandbox: Sandbox;
  baseSha: string;
  issue: IssueInput;
  cfg: RepoConfig;
  model?: string;
  log: Logger;
}): Promise<SolveResult> {
  const { engine, store, runId, sandbox, cfg, log } = o;

  if (cfg.install) {
    store.setPhase(runId, "install");
    log(`  installing: ${cfg.install}`);
    const res = await sandbox.exec(cfg.install, { timeoutMs: 15 * 60_000 });
    store.addEvent(runId, "install", { type: "tool_result", ok: res.code === 0, output: tail(res.stdout + res.stderr, 2000) });
    if (res.code !== 0) return { outcome: "env_setup", summary: `install failed: ${tail(res.stderr, 300)}` };
    // Install may touch lockfiles; don't count that as the agent's change.
    await hostGit(sandbox, ["add", "-A"]);
    await hostGit(sandbox, ["commit", "-qm", "ghost: install", "--allow-empty"]);
    o.baseSha = (await hostGit(sandbox, ["rev-parse", "HEAD"])).stdout.trim();
  }

  store.setPhase(runId, "fix");
  log(`  agent (${engine.name}) is working…`);
  const agent = await runAgent(engine, fixPrompt(o.issue, cfg), sandbox, store, runId, "fix", cfg.maxMinutes, o.model);
  const parsed = parseOutcome(agent.text);
  const summary = parsed.summary ?? parsed.skip ?? clip(agent.text.trim().split("\n").at(-1) ?? "", 300);

  if (agent.rateLimited) return { outcome: "rate_limited", summary: agent.error || "plan usage limit reached", rateLimitResetsAt: agent.resetsAt };
  if (parsed.skip) return { outcome: "agent_skipped", summary: parsed.skip };
  if (!agent.ok) return { outcome: /timed out/.test(agent.error) ? "timeout" : "engine_error", summary: agent.error || summary };

  store.setPhase(runId, "gate");
  log("  running the test-first gate…");
  const gate = await runGate({ sandbox, baseSha: o.baseSha, testCommand: cfg.test, testPatterns: cfg.testPatterns });
  store.update(runId, { gate_json: JSON.stringify({ ...gate, patch: clip(gate.patch, 50_000) }) });
  store.addEvent(runId, "gate", { type: "gate", passed: gate.passed, reason: gate.reason });
  return { outcome: gate.reason, summary, gate };
}

/** Record a walkthrough video of the fix. Failures here never block the PR. */
async function prove(o: { engine: Engine; store: Store; runId: number; sandbox: Sandbox; issue: IssueInput & { ref: string }; cfg: RepoConfig; summary: string; gate: GateResult; model?: string; log: Logger }) {
  const { store, runId, sandbox, cfg, log } = o;
  if (!cfg.prove) return undefined;
  store.setPhase(runId, "prove");
  log("  recording proof video…");
  const outDir = join(ghostHome(), "media", String(runId));
  await mkdir(outDir, { recursive: true });

  const agent = await runAgent(o.engine, proofPrompt(o.issue, o.summary, cfg.prove.url), sandbox, store, runId, "prove", 10, o.model);
  const script = join(sandbox.hostWorkdir, "ghost-proof", "proof.mjs");
  if (!agent.ok || !existsSync(script)) {
    log("  (no proof script written; skipping video)");
    return undefined;
  }
  const record = async (name: string, label: { text: string; color: string }) => {
    const stop = await startApp(sandbox, cfg.prove!.start);
    try {
      if (!(await waitForUrl(cfg.prove!.url, cfg.prove!.readyTimeoutSec ?? 90))) return { ok: false, error: "app never came up" };
      return await recordProof(script, cfg.prove!.url, outDir, { name, label });
    } finally {
      await stop();
    }
  };

  // BEFORE: the same walkthrough on the original code (the proof script itself
  // is git-excluded, so stashing the fix leaves it in place).
  let before: string | undefined;
  const stash = await hostGit(sandbox, ["stash", "push", "--include-untracked", "-q", "-m", "ghost-before"]);
  if (stash.code === 0) {
    try {
      const rec = await record("before", { text: "BEFORE", color: "#d1495b" });
      before = rec.video;
      store.addEvent(runId, "prove", { type: "proof", side: "before", ok: rec.ok, error: rec.error });
    } finally {
      await hostGit(sandbox, ["stash", "pop", "-q"]);
    }
  }

  const after = await record("after", { text: "AFTER ✓", color: "#1f8a4c" });
  store.addEvent(runId, "prove", { type: "proof", side: "after", ok: after.ok, error: after.error });
  if (!after.video) {
    log(`  (proof recording failed: ${after.error ?? "unknown"}; skipping video)`);
    return undefined;
  }
  const voice = await narrate(
    narrationText({ issueTitle: o.issue.title, issueRef: o.issue.ref, summary: o.summary, testFiles: o.gate.testFiles, sourceFiles: o.gate.sourceFiles, sideBySide: Boolean(before) }),
    outDir,
  );
  const media = await renderMedia({ before, after: after.video }, voice, outDir);
  store.update(runId, { video_path: media.mp4 ?? after.video });
  return { ...media, walkthroughOk: after.ok };
}

export function prBody(o: { issue: Issue; engine: string; summary: string; gate: GateResult; gifUrl?: string; mp4Url?: string; stats: { durationMs: number; inputTokens: number; outputTokens: number } }): string {
  const { gate } = o;
  const fence = (s?: string) => "```\n" + tail(s ?? "", 1500).trim() + "\n```";
  return `Fixes #${o.issue.number}

## What changed
${o.summary}

**Source:** ${gate.sourceFiles.map((f) => `\`${f}\``).join(", ")}
**New test:** ${gate.testFiles.map((f) => `\`${f}\``).join(", ")}

${o.gifUrl ? `## Proof\n![Walkthrough of the fix](${o.gifUrl})\n${o.mp4Url ? `\n🔊 [Narrated video](${o.mp4Url})\n` : ""}` : ""}
## Test-first evidence
<details><summary>❌ New test fails on the original code (exit ${gate.beforeCode})</summary>

${fence(gate.beforeOutput)}
</details>
<details><summary>✅ Full suite passes with the fix (exit ${gate.afterCode})</summary>

${fence(gate.afterOutput)}
</details>

---
👻 Opened by [Ghost Engineer](https://github.com/faizm10/ghost-engineer), an AI agent (${o.engine}), in ${Math.round(o.stats.durationMs / 60000)} min using ${(o.stats.inputTokens + o.stats.outputTokens).toLocaleString("en-US")} tokens. A human should review this before merging.
`;
}

async function openPr(o: { sandbox: Sandbox; issue: Issue; engine: string; runId: number; summary: string; gate: GateResult; media?: { gif?: string; mp4?: string }; draft: boolean; store: Store; log: Logger }) {
  const { sandbox, issue, store, runId, log } = o;
  store.setPhase(runId, "pr");
  const branch = `ghost/issue-${issue.number}-${o.engine}-${runId}`;
  await hostGit(sandbox, ["checkout", "-q", "-b", branch]);
  await hostGit(sandbox, ["add", "-A"]);
  await hostGit(sandbox, ["reset", "-q", "--", "ghost-proof"]);
  const commit = await hostGit(sandbox, ["commit", "-q", "-m", `Fix #${issue.number}: ${issue.title}\n\n${o.summary}\n\nGenerated by Ghost Engineer (${o.engine}).`]);
  if (commit.code !== 0) throw new Error(`commit failed: ${commit.stderr}`);

  let pushOwner = issue.owner;
  let pushRepo = issue.repo;
  if (!(await canPush(issue.owner, issue.repo))) {
    log("  no push access; using a fork");
    const fork = await ensureFork(issue.owner, issue.repo);
    pushOwner = fork.owner;
    pushRepo = fork.repo;
  }
  const remote = `https://github.com/${pushOwner}/${pushRepo}.git`;
  const push = await runProc("git", ["-C", sandbox.hostWorkdir, "push", "--quiet", remote, `HEAD:refs/heads/${branch}`], { timeoutMs: 5 * 60_000 });
  if (push.code !== 0) throw new Error(`git push failed (run \`gh auth setup-git\`): ${push.stderr}`);

  let gifUrl: string | undefined;
  let mp4Url: string | undefined;
  if (o.media?.gif) gifUrl = await uploadMedia(pushOwner, pushRepo, `ghost/${issue.number}-${runId}.gif`, await fileBase64(o.media.gif));
  if (o.media?.mp4) mp4Url = await uploadMedia(pushOwner, pushRepo, `ghost/${issue.number}-${runId}.mp4`, await fileBase64(o.media.mp4));

  const run = store.getRun(runId)!;
  const head = pushOwner === issue.owner ? branch : `${pushOwner}:${branch}`;
  const url = await createPullRequest({
    owner: issue.owner,
    repo: issue.repo,
    head,
    base: issue.defaultBranch,
    title: `Fix #${issue.number}: ${issue.title}`,
    body: prBody({ issue, engine: o.engine, summary: o.summary, gate: o.gate, gifUrl, mp4Url, stats: { durationMs: Date.now() - Date.parse(`${run.created_at}Z`), inputTokens: run.input_tokens, outputTokens: run.output_tokens } }),
    draft: o.draft,
  });
  store.update(runId, { pr_url: url, gif_url: gifUrl ?? null });
  return url;
}

export interface IssueRunOptions {
  engine: Engine;
  store: Store;
  sandboxKind?: SandboxKind;
  openPr?: boolean;
  draft?: boolean;
  prove?: boolean;
  model?: string;
  /** Required label for safety when processing issues automatically. */
  requireLabel?: string;
  dockerEnv?: Record<string, string>;
  log?: Logger;
}

export interface IssueRunResult extends SolveResult {
  runId: number;
  prUrl?: string;
}

/** Proof-video port to publish for Docker (it can't be added after the container starts). */
function provePorts(rawConfig: string | undefined, prove: boolean | undefined): number[] {
  if (prove === false || !rawConfig) return [];
  try {
    const url: string | undefined = JSON.parse(rawConfig).prove?.url;
    return url ? [Number(new URL(url).port || 80)] : [];
  } catch {
    return [];
  }
}

/**
 * Shared flow after triage: sandbox → solve → proof → (optional) PR.
 * `github` is present for real issues and enables opening a PR.
 */
async function execute(o: {
  runId: number;
  started: number;
  source: string;
  ref?: string;
  issue: IssueInput & { ref: string };
  ports: number[];
  github?: Issue;
  opts: IssueRunOptions;
}): Promise<IssueRunResult> {
  const { runId, started, opts } = o;
  const { store, engine } = opts;
  const log = opts.log ?? (() => {});
  let sandbox: Sandbox | undefined;
  try {
    store.setPhase(runId, "checkout");
    sandbox = await createSandbox(opts.sandboxKind, { env: opts.dockerEnv, ports: o.ports });
    const baseSha = await checkoutRepo(sandbox, o.source, o.ref);
    const cfg = detectRepoConfig(sandbox.hostWorkdir);

    const result = await solve({ engine, store, runId, sandbox, baseSha, issue: o.issue, cfg, model: opts.model, log });
    log(`  outcome: ${result.outcome}${result.summary ? ` (${clip(result.summary, 160)})` : ""}`);
    if (result.outcome !== "passed" || !result.gate) {
      const status = result.outcome === "agent_skipped" ? "skipped" : "failed";
      store.finish(runId, status, { outcome: result.outcome, summary: result.summary, duration_ms: Date.now() - started });
      return { runId, ...result };
    }

    const media = opts.prove === false ? undefined : await prove({ engine, store, runId, sandbox, issue: o.issue, cfg, summary: result.summary, gate: result.gate, model: opts.model, log });
    if (media?.mp4) log(`  🎬 video: ${media.mp4}`);

    let prUrl: string | undefined;
    if (opts.openPr && o.github) {
      prUrl = await openPr({ sandbox, issue: o.github, engine: engine.name, runId, summary: result.summary, gate: result.gate, media, draft: opts.draft ?? true, store, log });
      log(`  ✅ PR: ${prUrl}`);
    } else {
      log(`  ✅ gate passed${o.github ? " (dry run: pass --pr to open a PR)" : ""}`);
    }
    store.finish(runId, "succeeded", { outcome: "passed", summary: result.summary, duration_ms: Date.now() - started });
    return { runId, ...result, prUrl };
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    store.addEvent(runId, "error", { type: "error", message });
    store.finish(runId, "failed", { outcome: "engine_error", summary: clip(message, 500), duration_ms: Date.now() - started });
    log(`  ✖ ${message}`);
    return { runId, outcome: "engine_error", summary: message };
  } finally {
    await sandbox?.dispose();
  }
}

/** Full flow for one GitHub issue. */
export async function runIssue(issueUrl: string, opts: IssueRunOptions): Promise<IssueRunResult> {
  const log = opts.log ?? (() => {});
  const runId = opts.store.startRun("issue", issueUrl, opts.engine.name);
  const started = Date.now();
  let issue: Issue;
  try {
    opts.store.setPhase(runId, "triage");
    issue = await fetchIssue(issueUrl);
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    opts.store.finish(runId, "failed", { outcome: "engine_error", summary: clip(message, 500), duration_ms: Date.now() - started });
    log(`  ✖ ${message}`);
    return { runId, outcome: "engine_error", summary: message };
  }
  const ref = `${issue.owner}/${issue.repo}#${issue.number}`;
  log(`👻 ${ref}: ${issue.title}`);
  const reject = issue.state !== "open" ? "issue is closed" : opts.requireLabel && !issue.labels.includes(opts.requireLabel) ? `missing label "${opts.requireLabel}"` : undefined;
  if (reject) {
    opts.store.finish(runId, "skipped", { outcome: "triage_rejected", summary: reject, duration_ms: Date.now() - started });
    return { runId, outcome: "triage_rejected", summary: reject };
  }
  const ports = provePorts(await fetchRepoFile(issue.owner, issue.repo, ".ghost.json"), opts.prove);
  return execute({ runId, started, source: issue.cloneUrl, ref: issue.defaultBranch, issue: { title: issue.title, body: issue.body, ref }, ports, github: issue, opts });
}

/**
 * Same flow for a local path, git URL or `fixture:<name>`, with the bug
 * described in plain text. No GitHub issue needed and no PR is opened.
 */
export async function runLocal(source: string, bug: { title: string; body: string }, opts: IssueRunOptions): Promise<IssueRunResult> {
  const log = opts.log ?? (() => {});
  const resolved = await resolveSource(source);
  const runId = opts.store.startRun("issue", `local:${source}`, opts.engine.name);
  log(`👻 ${source}: ${bug.title}`);
  const cfgFile = join(resolved, ".ghost.json");
  const ports = provePorts(existsSync(cfgFile) ? readFileSync(cfgFile, "utf8") : undefined, opts.prove);
  return execute({ runId, started: Date.now(), source: resolved, issue: { ...bug, ref: source }, ports, opts });
}

export type { AgentEvent };
