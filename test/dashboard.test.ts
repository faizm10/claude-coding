import { describe, expect, it } from "vitest";
import { createDashboard, evalsPage, runPage, runsPage } from "../src/dashboard.js";
import { Store } from "../src/store.js";

describe("dashboard", () => {
  const store = new Store(":memory:");
  const id = store.startRun("issue", "https://github.com/o/r/issues/1", "claude");
  store.addEvent(id, "fix", { type: "message", text: "<script>alert(1)</script>" });
  store.addEvent(id, "fix", { type: "usage", inputTokens: 100, outputTokens: 20 });
  store.finish(id, "succeeded", { outcome: "passed", summary: "fixed <b>it</b>", duration_ms: 90_000, pr_url: "https://github.com/o/r/pull/2" });
  const e = store.startRun("eval", "toy/a", "codex", "toy");
  store.finish(e, "succeeded", { outcome: "resolved", resolved: 1, duration_ms: 60_000 });

  it("renders runs, escaping untrusted text", () => {
    const list = runsPage(store);
    expect(list).toContain("o/r/issues/1");
    expect(list).toContain('href="https://github.com/o/r/pull/2"');
    const detail = runPage(store, id)!;
    expect(detail).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(detail).not.toContain("<script>alert(1)");
    expect(detail).toContain("120"); // tokens
  });

  it("renders the eval leaderboard", () => {
    expect(evalsPage(store)).toContain("<b>codex</b>");
    expect(evalsPage(store)).toContain("100.0%");
  });

  it("serves pages over HTTP", async () => {
    const server = createDashboard(store).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const ok = await fetch(`http://127.0.0.1:${port}/runs/${id}`);
    const missing = await fetch(`http://127.0.0.1:${port}/runs/999`);
    server.close();
    expect(ok.status).toBe(200);
    expect(missing.status).toBe(404);
  });
});
