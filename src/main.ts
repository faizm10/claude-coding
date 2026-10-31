import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createDashboard } from "./dashboard.js";
import { createEngine, isEngineName } from "./engines/index.js";
import { loadSuite, runSuite, writeReport } from "./eval.js";
import { runIssue, runLocal } from "./pipeline.js";
import type { SandboxKind } from "./sandbox/index.js";
import { Store } from "./store.js";
import { importSwebench } from "./swebench.js";
import type { EngineName } from "./types.js";
import { runProc } from "./util/proc.js";
import { processQueue, watch } from "./worker.js";

const HELP = `👻 ghost: label an issue, wake up to a tested PR.

Usage:
  ghost run <issue-url | owner/repo#N>   Fix one issue now
  ghost fix <path|git-url|fixture:name> --title "…" [--body "…"]
                                         Same flow on a local repo, no GitHub issue
  ghost enqueue <issue...>               Add issues to the overnight queue
  ghost worker                           Work the queue (pauses on plan limits)
  ghost watch --repo owner/repo          Poll for labeled issues and fix them
  ghost eval <suite.json>                Benchmark engines on a task suite
  ghost report <suite-name>              Print the latest eval report
  ghost import-swebench                  Build a suite from SWE-bench Verified
  ghost serve                            Open the dashboard
  ghost doctor                           Check your setup

Common options:
  --engine claude|codex      Engine for run (default: claude)
  --engines claude,codex     Engines for enqueue/watch/eval
  --pr                       Actually push a branch and open a (draft) PR
  --ready                    Open PRs as ready for review instead of draft
  --no-prove                 Skip the browser proof video
  --sandbox auto|docker|local  Where the agent runs (default: auto)
  --model <name>             Model override passed to the engine CLI

Auth uses your logged-in plans: \`claude\` (Pro/Max) and \`codex\` (ChatGPT).
For servers/CI use \`claude setup-token\` → CLAUDE_CODE_OAUTH_TOKEN.`;

const log = (line: string) => process.stderr.write(`${line}\n`);

function engines(v: string | undefined, fallback: EngineName[]): EngineName[] {
  if (!v) return fallback;
  const list = v.split(",").map((s) => s.trim());
  for (const e of list) if (!isEngineName(e)) throw new Error(`unknown engine "${e}" (claude, codex, fake)`);
  return list as EngineName[];
}

function dockerEnv(): Record<string, string> {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {};
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return console.log(HELP);
  const { values: o, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      engine: { type: "string", default: "claude" },
      engines: { type: "string" },
      pr: { type: "boolean", default: false },
      ready: { type: "boolean", default: false },
      "no-prove": { type: "boolean", default: false },
      sandbox: { type: "string", default: "auto" },
      model: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      repo: { type: "string", multiple: true },
      label: { type: "string", default: "ghost" },
      interval: { type: "string", default: "300" },
      once: { type: "boolean", default: false },
      "max-jobs": { type: "string" },
      only: { type: "string" },
      tag: { type: "string" },
      limit: { type: "string" },
      resume: { type: "boolean", default: false },
      difficulty: { type: "string" },
      out: { type: "string" },
      port: { type: "string", default: "4545" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (!cmd || o.help || cmd === "help" || cmd === "--help" || cmd === "-h") return console.log(HELP);
  const sandboxKind = o.sandbox as SandboxKind;
  const runOpts = { sandboxKind, openPr: o.pr, draft: !o.ready, prove: !o["no-prove"], model: o.model, dockerEnv: dockerEnv() };

  switch (cmd) {
    case "run": {
      const [url] = positionals;
      if (!url) throw new Error("usage: ghost run <issue-url | owner/repo#N>");
      if (!isEngineName(o.engine!)) throw new Error(`unknown engine "${o.engine}"`);
      const store = new Store();
      const r = await runIssue(url, { ...runOpts, engine: createEngine(o.engine), store, log });
      log(`\nrun #${r.runId}: ${r.outcome}${r.prUrl ? ` → ${r.prUrl}` : ""}   (details: ghost serve)`);
      process.exitCode = r.outcome === "passed" ? 0 : 1;
      return;
    }
    case "fix": {
      const [source] = positionals;
      if (!source || !o.title) throw new Error('usage: ghost fix <path|git-url|fixture:name> --title "bug summary" [--body "details"]');
      if (!isEngineName(o.engine!)) throw new Error(`unknown engine "${o.engine}"`);
      const r = await runLocal(source, { title: o.title, body: o.body ?? "" }, { ...runOpts, openPr: false, engine: createEngine(o.engine), store: new Store(), log });
      log(`\nrun #${r.runId}: ${r.outcome}   (details: ghost serve)`);
      process.exitCode = r.outcome === "passed" ? 0 : 1;
      return;
    }
    case "enqueue": {
      const store = new Store();
      for (const url of positionals) for (const e of engines(o.engines, ["claude"])) log(store.enqueue(url, e) ? `+ ${url} (${e})` : `= already queued: ${url} (${e})`);
      return;
    }
    case "worker": {
      const store = new Store();
      const { processed } = await processQueue({ store, run: runOpts, once: o.once, maxJobs: o["max-jobs"] ? Number(o["max-jobs"]) : undefined, log });
      log(`processed ${processed} job(s)`);
      return;
    }
    case "watch": {
      if (!o.repo?.length) throw new Error("usage: ghost watch --repo owner/repo [--repo …] [--label ghost]");
      await watch({ store: new Store(), repos: o.repo, label: o.label!, engines: engines(o.engines, ["claude"]), intervalMs: Number(o.interval) * 1000, once: o.once, run: runOpts, maxJobs: o["max-jobs"] ? Number(o["max-jobs"]) : undefined, log });
      return;
    }
    case "eval": {
      const [path] = positionals;
      if (!path || !existsSync(path)) throw new Error("usage: ghost eval <suite.json> [--engines claude,codex]");
      const store = new Store();
      const suite = await loadSuite(path);
      const only = o.only?.split(",");
      const done = new Set(o.resume ? store.listRuns({ kind: "eval", suite: suite.name, limit: 100_000 }).filter((r) => r.status !== "running" && r.outcome !== "rate_limited").map((r) => `${r.target}::${r.engine}`) : []);
      let tasks = suite.tasks.filter((t) => (!only || only.includes(t.id)) && (!o.tag || t.tags?.includes(o.tag)));
      if (o.limit) tasks = tasks.slice(0, Number(o.limit));
      const list = engines(o.engines, ["claude"]);
      for (const engine of list) {
        await runSuite({ suite: { ...suite, tasks }, engines: [engine], store, sandboxKind, model: o.model, filter: (t) => !done.has(`${t.id}::${engine}`), log });
      }
      const { md, mdPath } = await writeReport(store, suite.name);
      console.log(`\n${md}\nSaved ${mdPath}`);
      return;
    }
    case "report": {
      const [name] = positionals;
      if (!name) throw new Error("usage: ghost report <suite-name>");
      console.log((await writeReport(new Store(), name)).md);
      return;
    }
    case "import-swebench": {
      const suite = await importSwebench({ limit: Number(o.limit ?? 50), difficulty: o.difficulty, repos: o.repo });
      const out = o.out ?? `suites/${suite.name}.json`;
      await writeFile(out, JSON.stringify(suite, null, 2));
      log(`wrote ${suite.tasks.length} tasks to ${out}`);
      return;
    }
    case "serve": {
      const port = Number(o.port);
      createDashboard(new Store()).listen(port, "127.0.0.1", () => log(`👻 dashboard: http://127.0.0.1:${port}`));
      return;
    }
    case "doctor": {
      const checks: [string, string[], string][] = [
        ["claude", ["--version"], "Claude Code CLI (npm i -g @anthropic-ai/claude-code)"],
        ["codex", ["--version"], "Codex CLI (npm i -g @openai/codex)"],
        ["gh", ["auth", "status"], "GitHub CLI, logged in (gh auth login)"],
        ["git", ["--version"], "git"],
        ["docker", ["info", "--format", "{{.ServerVersion}}"], "Docker (optional, for isolation)"],
        ["ffmpeg", ["-version"], "ffmpeg (optional, for proof videos)"],
      ];
      for (const [bin, args, what] of checks) {
        const r = await runProc(bin, args, { timeoutMs: 15_000 });
        log(`${r.code === 0 ? "✅" : "⚠️ "} ${what}`);
      }
      let pw = false;
      try {
        const m = await import("playwright");
        pw = existsSync(m.chromium.executablePath());
      } catch {}
      log(`${pw ? "✅" : "⚠️ "} Playwright Chromium (optional: npx playwright install chromium)`);
      const tts = (await runProc("say", ["-v", "?"])).code === 0 || (await runProc("espeak-ng", ["--version"])).code === 0;
      log(`${tts ? "✅" : "⚠️ "} Text-to-speech: say or espeak-ng (optional, for narration)`);
      return;
    }
    default:
      throw new Error(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

main().catch((err) => {
  log(`✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
