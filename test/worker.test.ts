import { describe, expect, it } from "vitest";
import { backoffMs, processQueue } from "../src/worker.js";
import { Store } from "../src/store.js";
import type { IssueRunResult } from "../src/pipeline.js";

describe("worker", () => {
  it("backs off exponentially, capped at 5h", () => {
    expect(backoffMs(1)).toBe(30 * 60_000);
    expect(backoffMs(2)).toBe(60 * 60_000);
    expect(backoffMs(10)).toBe(5 * 60 * 60_000);
  });

  it("completes successful jobs and pauses everything on a plan limit", async () => {
    const store = new Store(":memory:");
    store.enqueue("https://github.com/o/r/issues/1", "fake");
    store.enqueue("https://github.com/o/r/issues/2", "fake");
    store.enqueue("https://github.com/o/r/issues/3", "fake");
    let t = 1_000_000;
    const resetAt = t + 3_600_000;
    const outcomes: IssueRunResult[] = [
      { runId: 1, outcome: "passed", summary: "ok" },
      { runId: 2, outcome: "rate_limited", summary: "limit", rateLimitResetsAt: resetAt },
    ];
    const seen: string[] = [];
    const res = await processQueue({
      store, once: true, now: () => t,
      runIssueFn: async (url) => (seen.push(url), outcomes.shift()!),
    });
    expect(res.processed).toBe(2);
    expect(seen).toHaveLength(2); // job 3 not attempted while paused
    const jobs = store.listJobs().sort((a, b) => a.id - b.id);
    expect(jobs.map((j) => j.status)).toEqual(["done", "queued", "queued"]);
    expect(jobs[1].not_before).toBe(resetAt);

    // After the window resets, the paused job runs again.
    t = resetAt + 1;
    outcomes.push({ runId: 3, outcome: "passed", summary: "ok" }, { runId: 4, outcome: "no_test", summary: "x" });
    await processQueue({ store, once: true, now: () => t, runIssueFn: async () => outcomes.shift()! });
    expect(store.listJobs().every((j) => j.status !== "queued")).toBe(true);
  });

  it("does not enqueue the same issue twice", () => {
    const store = new Store(":memory:");
    expect(store.enqueue("u", "claude")).toBe(true);
    expect(store.enqueue("u", "claude")).toBe(false);
    expect(store.enqueue("u", "codex")).toBe(true);
  });
});
