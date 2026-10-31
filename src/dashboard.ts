import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname } from "node:path";
import { buildReport, type EngineReport } from "./eval.js";
import type { RunRow, Store } from "./store.js";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmtMin = (ms: number | null) => (ms == null ? "—" : `${(ms / 60000).toFixed(1)}m`);
const fmtTok = (r: RunRow) => (r.input_tokens + r.output_tokens).toLocaleString("en-US");

const STATUS_ICON: Record<string, string> = { succeeded: "✅", failed: "❌", skipped: "⏭️", running: "⏳" };

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Ghost Engineer</title>
<style>
:root{--bg:#fbfaf7;--panel:#fff;--text:#1d1b18;--muted:#6f6a62;--line:#e6e2da;--accent:#6d4aff;--ok:#1f8a4c;--bad:#c2410c;--code:#f4f2ee}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--panel:#1b1b1d;--text:#ececec;--muted:#9a9aa0;--line:#2c2c30;--accent:#a08bff;--ok:#4ade80;--bad:#fb923c;--code:#202024}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}a{color:var(--accent)}
nav{display:flex;gap:16px;align-items:center;margin-bottom:24px}nav b{font-size:18px;margin-right:auto}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.wrap{overflow-x:auto}.muted{color:var(--muted)}.ok{color:var(--ok)}.bad{color:var(--bad)}
pre{background:var(--code);padding:12px;border-radius:8px;overflow-x:auto;font-size:12.5px;white-space:pre-wrap;word-break:break-word}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.stat b{display:block;font-size:22px}
.ev{font:12.5px ui-monospace,Menlo,monospace;padding:4px 0;border-bottom:1px dashed var(--line)}.ev span{color:var(--muted);margin-right:8px}
video{width:100%;border-radius:8px;background:#000}.bar{height:10px;border-radius:5px;background:var(--accent)}
</style></head><body><main>
<nav><b>👻 Ghost Engineer</b><a href="/">Runs</a><a href="/evals">Evals</a><a href="/jobs">Queue</a></nav>
${body}</main></body></html>`;
}

export function runsPage(store: Store): string {
  const runs = store.listRuns({ limit: 300 });
  const rows = runs
    .map(
      (r) => `<tr><td><a href="/runs/${r.id}">#${r.id}</a></td><td>${STATUS_ICON[r.status] ?? ""} ${esc(r.outcome ?? r.phase)}</td>
<td>${r.kind === "issue" ? `<a href="${esc(r.target)}">${esc(r.target.replace("https://github.com/", ""))}</a>` : esc(r.target)}</td>
<td>${esc(r.engine)}</td><td>${fmtMin(r.duration_ms)}</td><td>${fmtTok(r)}</td>
<td>${r.pr_url ? `<a href="${esc(r.pr_url)}">PR</a>` : ""}</td><td class="muted">${esc(r.created_at)}</td></tr>`,
    )
    .join("");
  return layout(
    "Runs",
    runs.length
      ? `<div class="wrap"><table><tr><th>Run</th><th>Outcome</th><th>Target</th><th>Engine</th><th>Time</th><th>Tokens</th><th></th><th>Started</th></tr>${rows}</table></div>`
      : `<p class="muted">No runs yet. Try <code>ghost run owner/repo#123</code> or <code>ghost eval suites/toy-shop.json</code>.</p>`,
  );
}

function renderEvent(e: { ts: number; phase: string; type: string; data: string }): string {
  const d = JSON.parse(e.data);
  const time = new Date(e.ts).toLocaleTimeString();
  const body =
    d.type === "message" ? esc(d.text)
    : d.type === "tool" ? `🔧 <b>${esc(d.name)}</b> ${esc(d.input)}`
    : d.type === "tool_result" ? `<span class="${d.ok ? "ok" : "bad"}">${d.ok ? "✓" : "✗"}</span> ${esc(String(d.output).slice(0, 400))}`
    : d.type === "file_change" ? `📝 ${esc(d.path)}`
    : d.type === "usage" ? `tokens in ${d.inputTokens} / out ${d.outputTokens}`
    : d.type === "rate_limit" ? `plan window ${esc(d.window)}: ${esc(d.status)}${d.utilization != null ? ` (${Math.round(d.utilization * 100)}% used)` : ""}`
    : esc(JSON.stringify(d).slice(0, 400));
  return `<div class="ev"><span>${time} · ${esc(e.phase)}</span>${body}</div>`;
}

export function runPage(store: Store, id: number): string | undefined {
  const r = store.getRun(id);
  if (!r) return undefined;
  const gate = r.gate_json ? JSON.parse(r.gate_json) : undefined;
  const events = store.events(id);
  return layout(
    `Run #${id}`,
    `<h1>${STATUS_ICON[r.status] ?? ""} Run #${id}: ${esc(r.outcome ?? r.phase)}</h1>
<p class="muted">${esc(r.kind)} · ${esc(r.engine)} · ${r.kind === "issue" ? `<a href="${esc(r.target)}">${esc(r.target)}</a>` : esc(r.target)} ${r.pr_url ? `· <a href="${esc(r.pr_url)}">Pull request</a>` : ""}</p>
<div class="grid">
  <div class="card stat"><b>${fmtMin(r.duration_ms)}</b><span class="muted">wall time</span></div>
  <div class="card stat"><b>${fmtTok(r)}</b><span class="muted">tokens</span></div>
  <div class="card stat"><b>${gate ? (gate.passed ? "passed" : esc(gate.reason)) : "—"}</b><span class="muted">test-first gate</span></div>
  ${r.kind === "eval" ? `<div class="card stat"><b>${r.resolved ? "yes" : "no"}</b><span class="muted">resolved (hidden tests)</span></div>` : ""}
</div>
${r.summary ? `<div class="card"><b>Summary</b><p>${esc(r.summary)}</p></div>` : ""}
${r.video_path && existsSync(r.video_path) ? `<div class="card"><b>Proof video</b><video controls src="/media/${id}"></video></div>` : ""}
${gate ? `<div class="card"><b>Gate evidence</b><p>Tests: ${esc(gate.testFiles.join(", ") || "none")}<br>Source: ${esc(gate.sourceFiles.join(", ") || "none")}</p>
${gate.beforeOutput != null ? `<details><summary>Before fix (exit ${gate.beforeCode})</summary><pre>${esc(gate.beforeOutput)}</pre></details><details><summary>After fix (exit ${gate.afterCode})</summary><pre>${esc(gate.afterOutput)}</pre></details>` : ""}
<details><summary>Patch</summary><pre>${esc(gate.patch)}</pre></details></div>` : ""}
<div class="card"><b>Trace (${events.length} events)</b>${events.map(renderEvent).join("")}</div>`,
  );
}

function leaderboard(report: EngineReport[]): string {
  const best = Math.max(0.0001, ...report.map((r) => r.resolveRate));
  const rows = report
    .sort((a, b) => b.resolveRate - a.resolveRate)
    .map(
      (r) => `<tr><td><b>${esc(r.engine)}</b></td><td>${r.resolved}/${r.tasks}</td>
<td style="min-width:160px"><div class="bar" style="width:${((r.resolveRate / best) * 100).toFixed(0)}%"></div>${(r.resolveRate * 100).toFixed(1)}%</td>
<td>${(r.gatePassRate * 100).toFixed(1)}%</td><td>${r.medianMinutes.toFixed(1)}m / ${r.p95Minutes.toFixed(1)}m</td>
<td>${Math.round(r.avgTokens).toLocaleString("en-US")}</td><td>${r.costUsd ? `$${r.costUsd.toFixed(2)}` : "—"}</td>
<td class="muted">${Object.entries(r.outcomes).map(([k, v]) => `${esc(k)}: ${v}`).join("<br>")}</td></tr>`,
    )
    .join("");
  return `<div class="wrap"><table><tr><th>Engine</th><th>Resolved</th><th>Resolve rate</th><th>Gate pass</th><th>p50 / p95</th><th>Avg tokens</th><th>Cost*</th><th>Outcomes</th></tr>${rows}</table></div>`;
}

export function evalsPage(store: Store): string {
  const suites = store.suites();
  const sections = suites
    .map((s) => `<h2>${esc(s)}</h2>${leaderboard(buildReport(store.listRuns({ kind: "eval", suite: s, limit: 100_000 })))}`)
    .join("");
  return layout(
    "Evals",
    suites.length
      ? `${sections}<p class="muted">* API-equivalent cost reported by Claude Code; not billed on a subscription. "Gate pass" = the agent's own failing test + fix held up; "Resolved" = hidden tests pass.</p>`
      : `<p class="muted">No evals yet. Run <code>ghost eval suites/toy-shop.json --engines claude,codex</code>.</p>`,
  );
}

export function jobsPage(store: Store): string {
  const jobs = store.listJobs();
  const rows = jobs
    .map((j) => `<tr><td>${j.id}</td><td>${esc(j.status)}</td><td><a href="${esc(j.issue_url)}">${esc(j.issue_url.replace("https://github.com/", ""))}</a></td><td>${esc(j.engine)}</td><td>${j.attempts}</td>
<td class="muted">${j.not_before > Date.now() ? `after ${esc(new Date(j.not_before).toLocaleString())}` : ""}</td><td>${j.run_id ? `<a href="/runs/${j.run_id}">#${j.run_id}</a>` : ""}</td><td class="muted">${esc(j.last_error?.slice(0, 120))}</td></tr>`)
    .join("");
  return layout("Queue", jobs.length ? `<div class="wrap"><table><tr><th>Job</th><th>Status</th><th>Issue</th><th>Engine</th><th>Tries</th><th>Wait</th><th>Run</th><th>Last error</th></tr>${rows}</table></div>` : `<p class="muted">Queue is empty.</p>`);
}

const MIME: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm", ".gif": "image/gif" };

export function createDashboard(store: Store): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (code: number, body: string, type = "text/html; charset=utf-8") => {
      res.writeHead(code, { "content-type": type });
      res.end(body);
    };
    try {
      if (url.pathname === "/") return send(200, runsPage(store));
      if (url.pathname === "/evals") return send(200, evalsPage(store));
      if (url.pathname === "/jobs") return send(200, jobsPage(store));
      if (url.pathname === "/api/runs") return send(200, JSON.stringify(store.listRuns({ limit: 1000 })), "application/json");
      const run = url.pathname.match(/^\/runs\/(\d+)$/);
      if (run) {
        const page = runPage(store, Number(run[1]));
        return page ? send(200, page) : send(404, layout("Not found", "<p>No such run.</p>"));
      }
      const media = url.pathname.match(/^\/media\/(\d+)$/);
      if (media) {
        const r = store.getRun(Number(media[1]));
        if (!r?.video_path || !existsSync(r.video_path)) return send(404, "not found", "text/plain");
        res.writeHead(200, { "content-type": MIME[extname(r.video_path)] ?? "application/octet-stream", "content-length": statSync(r.video_path).size });
        return void createReadStream(r.video_path).pipe(res);
      }
      send(404, layout("Not found", "<p>Not found.</p>"));
    } catch (err) {
      send(500, layout("Error", `<pre>${esc(err)}</pre>`));
    }
  });
}
