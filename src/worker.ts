import { createEngine } from "./engines/index.js";
import { listLabeledIssues } from "./github.js";
import { runIssue, type IssueRunOptions, type IssueRunResult, type Logger } from "./pipeline.js";
import type { Store } from "./store.js";
import type { EngineName } from "./types.js";

const MIN = 60_000;

/** Exponential backoff capped at one plan window (5h). */
export function backoffMs(attempts: number): number {
  return Math.min(5 * 60 * MIN, 30 * MIN * 2 ** Math.max(0, attempts - 1));
}

export interface WorkerOptions {
  store: Store;
  run?: Omit<IssueRunOptions, "engine" | "store" | "log">;
  /** Process what's runnable now, then exit (for cron / GitHub Actions). */
  once?: boolean;
  /** Stop after this many jobs (protects the plan's usage window). */
  maxJobs?: number;
  log?: Logger;
  /** Injected for tests. */
  runIssueFn?: (url: string, opts: IssueRunOptions) => Promise<IssueRunResult>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Drain the job queue. All jobs share one subscription, so a rate-limited job
 * pauses the whole worker until the plan window resets.
 */
export async function processQueue(o: WorkerOptions): Promise<{ processed: number }> {
  const log = o.log ?? (() => {});
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const run = o.runIssueFn ?? runIssue;
  let processed = 0;
  let pausedUntil = 0;

  while (o.maxJobs === undefined || processed < o.maxJobs) {
    if (now() < pausedUntil) {
      if (o.once) break;
      await sleep(Math.min(pausedUntil - now(), 5 * MIN));
      continue;
    }
    const job = o.store.claimJob(now());
    if (!job) {
      if (o.once) break;
      const wake = o.store.nextWakeup();
      await sleep(wake ? Math.max(1000, Math.min(wake - now(), 5 * MIN)) : MIN);
      continue;
    }

    log(`▶ job ${job.id} (${job.engine}, attempt ${job.attempts}): ${job.issue_url}`);
    const result = await run(job.issue_url, { ...o.run, engine: createEngine(job.engine as EngineName), store: o.store, log, requireLabel: o.run?.requireLabel });
    processed++;

    if (result.outcome === "rate_limited") {
      const until = result.rateLimitResetsAt ?? now() + backoffMs(job.attempts);
      pausedUntil = until;
      o.store.retryJob(job.id, until, result.summary);
      log(`⏸ plan limit hit; pausing until ${new Date(until).toLocaleString()}`);
    } else if (result.outcome === "engine_error" && job.attempts < 3) {
      o.store.retryJob(job.id, now() + 10 * MIN * job.attempts, result.summary);
      log(`↻ engine error; retrying later (${result.summary.slice(0, 120)})`);
    } else {
      o.store.completeJob(job.id, result.runId, result.outcome === "passed", result.outcome === "passed" ? undefined : result.summary);
    }
  }
  return { processed };
}

/** Poll repos for issues carrying the label, enqueue them, and work the queue. */
export async function watch(o: WorkerOptions & { repos: string[]; label: string; engines: EngineName[]; intervalMs: number }) {
  const log = o.log ?? (() => {});
  for (;;) {
    for (const repo of o.repos) {
      try {
        for (const url of await listLabeledIssues(repo, o.label)) {
          for (const engine of o.engines) if (o.store.enqueue(url, engine)) log(`+ queued ${url} (${engine})`);
        }
      } catch (err) {
        log(`! could not list issues for ${repo}: ${String(err)}`);
      }
    }
    await processQueue({ ...o, once: true, run: { ...o.run, requireLabel: o.label } });
    if (o.once) return;
    await new Promise((r) => setTimeout(r, o.intervalMs));
  }
}
