import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { narrate, narrationText, recordProof, renderMedia, waitForUrl } from "../src/proof.js";
import { runProc } from "../src/util/proc.js";

const hasFfmpeg = (await runProc("ffmpeg", ["-version"])).code === 0;
let hasBrowser = false;
try {
  const pw = await import("playwright");
  hasBrowser = existsSync(pw.chromium.executablePath());
} catch {}

describe.skipIf(!hasFfmpeg || !hasBrowser)("proof video pipeline", () => {
  it("records a walkthrough, narrates it and renders mp4 + gif", async () => {
    const server = createServer((_, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(`<button onclick="this.textContent='Saved ✓'">Save</button>`);
    });
    await new Promise<void>((r) => server.listen(0, r));
    const url = `http://localhost:${(server.address() as { port: number }).port}`;
    try {
      expect(await waitForUrl(url, 5)).toBe(true);
      const dir = await mkdtemp(join(tmpdir(), "ghost-proof-"));
      const script = join(dir, "proof.mjs");
      await writeFile(script, `export default async (page, base) => {
        await page.goto(base); await page.waitForTimeout(300);
        await page.click("button");
        await page.getByText("Saved ✓").waitFor();
      };`);
      const rec = await recordProof(script, url, dir);
      expect(rec.error).toBeUndefined();
      expect(rec.ok).toBe(true);
      const voice = await narrate(
        narrationText({ issueTitle: "Save button does nothing", summary: "The click handler was never bound", testFiles: ["t.test.js"], sourceFiles: ["src/save.js"] }),
        dir,
      );
      const before = await recordProof(script, url, dir, { name: "before", label: { text: "BEFORE", color: "#d1495b" } });
      const media = await renderMedia({ before: before.video, after: rec.video! }, voice, dir);
      expect(media.mp4 && existsSync(media.mp4)).toBe(true);
      expect(media.gif && existsSync(media.gif)).toBe(true);
    } finally {
      server.close();
    }
  }, 120_000);
});
