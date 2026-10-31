# 👻 Ghost Engineer

**Label a GitHub issue `ghost`. Wake up to a tested pull request, with a narrated video of the fix working.**

Ghost Engineer is an autonomous bug-fixing agent that runs on your **Claude Code** or **Codex** subscription (no API keys). It reproduces the bug with a failing test, fixes it, proves the fix with a **test-first gate**, records a browser walkthrough with voiceover, and opens a draft PR. It also benchmarks **Claude Code against Codex** on the same tasks.

```
issue labeled "ghost"
   │
   ▼
triage ─► sandbox (Docker, or a temp clone) ─► install
   │
   ▼
agent (Claude Code │ Codex) writes a FAILING test, then the fix
   │
   ▼
test-first gate:  original code + new test  → must FAIL
                  full change               → whole suite must PASS
   │
   ▼
proof: agent writes a Playwright walkthrough → video → TTS narration → MP4 + GIF
   │
   ▼
draft PR: summary · before/after test evidence · inline GIF · narrated MP4 link
   │
   ▼
traces, cost and timing → SQLite → dashboard + eval leaderboard
```

## Results so far

Smoke suite (`suites/toy-shop.json`, three planted bugs), run through the full harness:

| Engine | Resolved | Gate pass | Median time | Avg tokens |
|---|---|---|---|---|
| Claude Code | 3/3 | 100% | 0.4 min | ~115k |
| Codex | 3/3 | 100% | 0.3 min | ~106k |

This is a harness smoke test, not a benchmark. The real benchmark is **SWE-bench Verified**: `ghost import-swebench` pulls real issues from projects like Django and Astropy, graded by their hidden `FAIL_TO_PASS` tests.

## Why it's built this way

- **Engine-agnostic.** One `Engine` interface, with adapters that drive `claude -p --output-format stream-json` and `codex exec --json` and normalize both streams into one event format. Switching engines is a flag, which is what makes head-to-head evals possible.
- **Test-first gate.** An agent saying "fixed!" means nothing. A PR is only allowed if the agent's new test **fails on the original code** and the **whole suite passes** with the fix. This rejects fixes that never reproduced the bug and fixes that break other tests.
- **Hidden-test grading.** Evals grade the final code with tests the agent never saw. That separates `resolved` from `wrong_fix`: passed our gate, failed the hidden tests. The eval tests include an agent that special-cases the example input, and it's caught.
- **Plan-aware scheduling.** Claude Code reports its usage window (`five_hour`, `seven_day`, with reset times). When a limit is hit, the worker pauses the whole queue until the window resets, because every job shares one subscription.
- **Security model.**
  - Issue text is untrusted. It's passed as fenced data, never as instructions, and fence breakouts are neutralized.
  - The agent and the repo's own test code run with a **scrubbed environment**: GitHub tokens and other credentials are removed, which was verified with a canary token.
  - With Docker, each job gets its own container: unprivileged user, resource limits, `no-new-privileges`. The container never holds git credentials, because cloning and pushing happen on the host.
  - PRs open as **drafts** with an AI disclosure. Nothing auto-merges.
- **Observable.** Every tool call, file edit, token count and plan-window update is stored in SQLite and shown in the dashboard.

## Quick start

```sh
npm install && npm run build && npm link   # installs the `ghost` command
ghost doctor                               # checks claude, codex, gh, docker, ffmpeg, playwright

# Benchmark both engines on the smoke suite (about 1 minute)
ghost eval suites/toy-shop.json --engines claude,codex

# Fix a real issue (dry run: gate only, no PR)
ghost run owner/repo#123 --engine claude

# Same, but push a branch and open a draft PR
ghost run owner/repo#123 --engine codex --pr

# Overnight mode: poll for `ghost`-labeled issues and work the queue
ghost watch --repo owner/repo --engines claude --pr

# Real benchmark
ghost import-swebench --limit 50 --difficulty "<15 min fix"
ghost eval suites/swebench-verified-50.json --engines claude,codex --resume

ghost serve    # dashboard at http://127.0.0.1:4545
```

**Auth:** Ghost Engineer uses your logged-in CLIs: `claude` (Pro/Max) and `codex` (ChatGPT plan). For CI or a server, run `claude setup-token` and set `CLAUDE_CODE_OAUTH_TOKEN`. To run nightly in GitHub Actions, see [`templates/ghost.yml`](templates/ghost.yml).

**Terms:** running on your own subscription is meant for your own repos and personal use. If other people will trigger runs, switch to API keys; the `Engine` interface makes that a config change.

## Per-repo config (optional)

Put `.ghost.json` in the target repo. Without it, Ghost Engineer auto-detects npm, pytest, go and cargo projects.

```json
{
  "install": "npm ci",
  "test": "npm test",
  "maxMinutes": 30,
  "prove": { "start": "npm run dev -- --port 3000", "url": "http://localhost:3000" }
}
```

Add a `prove` block if the app has a UI. That turns on the walkthrough video: Playwright plus `say` or `espeak-ng` plus ffmpeg.

## Sandboxes

| Mode | Isolation | When |
|---|---|---|
| `docker` | Container per job (`docker/Dockerfile`) | Untrusted repos and open-source issues |
| `local` | A temp clone on the host, credentials scrubbed, local tool allowlist for Claude, `workspace-write` sandbox for Codex | Your own repos, or CI runners (disposable VMs) |

`--sandbox auto` (the default) uses Docker when it's available, and otherwise warns and falls back to `local`.

## Project layout

```
src/engines/     Claude Code and Codex adapters + stream parsers (tested on real captures)
src/sandbox/     Docker and local sandboxes, repo checkout
src/gate.ts      test-first gate
src/pipeline.ts  issue → fix → gate → proof → PR
src/proof.ts     Playwright recording, TTS narration, ffmpeg rendering
src/eval.ts      suites, hidden-test grading, reports
src/swebench.ts  SWE-bench Verified importer
src/worker.ts    job queue with plan-window-aware pausing
src/dashboard.ts local web UI
templates/       GitHub Actions workflow for target repos
```

## Roadmap

- [ ] Run SWE-bench Verified (50 tasks) on both engines and publish the cost/quality chart
- [ ] Best-of-N attempts with a judge agent
- [ ] Learn from review comments on rejected PRs
- [ ] Slack/Discord notification with the proof video
