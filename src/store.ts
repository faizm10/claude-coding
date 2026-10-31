import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentEvent } from "./types.js";

export interface RunRow {
  id: number;
  created_at: string;
  finished_at: string | null;
  kind: "issue" | "eval";
  target: string; // issue URL or eval task id
  suite: string | null;
  engine: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  phase: string;
  outcome: string | null; // gate reason / failure category
  resolved: number | null; // eval only: 1 if hidden tests passed
  summary: string | null;
  duration_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  pr_url: string | null;
  video_path: string | null;
  gif_url: string | null;
  gate_json: string | null;
}

export interface JobRow {
  id: number;
  issue_url: string;
  engine: string;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  not_before: number; // unix ms
  run_id: number | null;
  created_at: string;
  last_error: string | null;
}

export function ghostHome(): string {
  return process.env.GHOST_HOME ?? join(process.cwd(), ".ghost");
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path = join(ghostHome(), "ghost.db")) {
    if (path !== ":memory:") mkdirSync(join(path, ".."), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        suite TEXT,
        engine TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        phase TEXT NOT NULL DEFAULT 'start',
        outcome TEXT,
        resolved INTEGER,
        summary TEXT,
        duration_ms INTEGER,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL,
        pr_url TEXT,
        video_path TEXT,
        gif_url TEXT,
        gate_json TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        run_id INTEGER NOT NULL REFERENCES runs(id),
        ts INTEGER NOT NULL,
        phase TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_run ON events(run_id);
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_url TEXT NOT NULL,
        engine TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        not_before INTEGER NOT NULL DEFAULT 0,
        run_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_error TEXT,
        UNIQUE(issue_url, engine)
      );
    `);
  }

  startRun(kind: RunRow["kind"], target: string, engine: string, suite?: string): number {
    const r = this.db.prepare("INSERT INTO runs (kind, target, engine, suite) VALUES (?, ?, ?, ?)").run(kind, target, engine, suite ?? null);
    return Number(r.lastInsertRowid);
  }

  setPhase(runId: number, phase: string) {
    this.db.prepare("UPDATE runs SET phase = ? WHERE id = ?").run(phase, runId);
  }

  update(runId: number, fields: Partial<Omit<RunRow, "id">>) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    const sql = `UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
    this.db.prepare(sql).run(...keys.map((k) => (fields as Record<string, unknown>)[k] as any), runId);
  }

  finish(runId: number, status: RunRow["status"], fields: Partial<Omit<RunRow, "id">> = {}) {
    this.update(runId, { ...fields, status, finished_at: new Date().toISOString().replace("T", " ").slice(0, 19) });
  }

  addEvent(runId: number, phase: string, ev: AgentEvent | { type: string; [k: string]: unknown }) {
    this.db.prepare("INSERT INTO events (run_id, ts, phase, type, data) VALUES (?, ?, ?, ?, ?)").run(runId, Date.now(), phase, ev.type, JSON.stringify(ev));
    if (ev.type === "usage") {
      const u = ev as Extract<AgentEvent, { type: "usage" }>;
      this.db
        .prepare("UPDATE runs SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cost_usd = COALESCE(cost_usd, 0) + ? WHERE id = ?")
        .run(u.inputTokens, u.outputTokens, u.costUsd ?? 0, runId);
    }
  }

  getRun(id: number): RunRow | undefined {
    return this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  }

  listRuns(opts: { kind?: string; suite?: string; limit?: number } = {}): RunRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.kind) (where.push("kind = ?"), args.push(opts.kind));
    if (opts.suite) (where.push("suite = ?"), args.push(opts.suite));
    const sql = `SELECT * FROM runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`;
    return this.db.prepare(sql).all(...args, opts.limit ?? 200) as unknown as RunRow[];
  }

  events(runId: number): { ts: number; phase: string; type: string; data: string }[] {
    return this.db.prepare("SELECT ts, phase, type, data FROM events WHERE run_id = ? ORDER BY rowid").all(runId) as any;
  }

  suites(): string[] {
    return (this.db.prepare("SELECT DISTINCT suite FROM runs WHERE suite IS NOT NULL ORDER BY suite").all() as { suite: string }[]).map((r) => r.suite);
  }

  // ---- job queue ----
  enqueue(issueUrl: string, engine: string): boolean {
    const r = this.db.prepare("INSERT OR IGNORE INTO jobs (issue_url, engine) VALUES (?, ?)").run(issueUrl, engine);
    return r.changes > 0;
  }

  /** Atomically claim the next runnable job. */
  claimJob(now = Date.now()): JobRow | undefined {
    const job = this.db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND not_before <= ? ORDER BY id LIMIT 1").get(now) as JobRow | undefined;
    if (!job) return undefined;
    const r = this.db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ? AND status = 'queued'").run(job.id);
    return r.changes ? { ...job, status: "running", attempts: job.attempts + 1 } : undefined;
  }

  completeJob(id: number, runId: number, ok: boolean, error?: string) {
    this.db.prepare("UPDATE jobs SET status = ?, run_id = ?, last_error = ? WHERE id = ?").run(ok ? "done" : "failed", runId, error ?? null, id);
  }

  retryJob(id: number, notBefore: number, error: string) {
    this.db.prepare("UPDATE jobs SET status = 'queued', not_before = ?, last_error = ? WHERE id = ?").run(notBefore, error, id);
  }

  listJobs(): JobRow[] {
    return this.db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT 200").all() as unknown as JobRow[];
  }

  nextWakeup(): number | undefined {
    const r = this.db.prepare("SELECT MIN(not_before) AS t FROM jobs WHERE status = 'queued'").get() as { t: number | null };
    return r.t ?? undefined;
  }
}
