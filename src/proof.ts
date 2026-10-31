import { existsSync } from "node:fs";
import { mkdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Sandbox } from "./types.js";
import { runProc, shq } from "./util/proc.js";

/** Start the app in the background (own process group so we can kill the whole tree). */
export async function startApp(sandbox: Sandbox, start: string): Promise<() => Promise<void>> {
  const pidFile = `/tmp/ghost-app-${sandbox.id}.pid`;
  const log = `/tmp/ghost-app-${sandbox.id}.log`;
  await sandbox.exec(`set -m; (${start}) > ${log} 2>&1 < /dev/null & echo $! > ${pidFile}`);
  return async () => {
    await sandbox.exec(`[ -f ${pidFile} ] && kill -TERM -- -$(cat ${pidFile}) 2>/dev/null; rm -f ${pidFile}`);
  };
}

export async function waitForUrl(url: string, timeoutSec = 90): Promise<boolean> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Corner badge injected into every page so viewers know which side they're watching. */
function badgeScript(label: string, color: string): string {
  return `(() => {
    const add = () => {
      if (document.getElementById("__ghost_badge")) return;
      const b = document.createElement("div");
      b.id = "__ghost_badge";
      b.textContent = ${JSON.stringify(label)};
      b.style.cssText = "position:fixed;top:14px;left:14px;z-index:2147483647;padding:6px 14px;border-radius:999px;font:700 22px/1.2 system-ui,sans-serif;letter-spacing:.08em;color:#fff;background:${color};box-shadow:0 4px 14px rgba(0,0,0,.25);pointer-events:none";
      document.documentElement.appendChild(b);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
  })();`;
}

/** Run the agent-written walkthrough in Chromium and record it as WebM. */
export async function recordProof(
  script: string,
  baseUrl: string,
  outDir: string,
  opts: { name?: string; label?: { text: string; color: string } } = {},
): Promise<{ ok: boolean; video?: string; error?: string }> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    return { ok: false, error: "playwright is not installed (npm i playwright && npx playwright install chromium)" };
  }
  await mkdir(outDir, { recursive: true });
  const browser = await playwright.chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  if (opts.label) await context.addInitScript(badgeScript(opts.label.text, opts.label.color));
  const page = await context.newPage();
  let error: string | undefined;
  try {
    const mod = await import(`${pathToFileURL(script).href}?t=${Date.now()}`);
    await mod.default(page, baseUrl);
  } catch (err) {
    error = String(err);
  }
  await page.waitForTimeout(1200).catch(() => {}); // hold the final frame
  const video = page.video();
  await context.close();
  await browser.close();
  const raw = video ? await video.path() : undefined;
  if (!raw) return { ok: false, error: error ?? "no video recorded" };
  const dest = join(outDir, `${opts.name ?? "proof"}.webm`);
  await rename(raw, dest);
  return { ok: !error, video: dest, error };
}

/** Text-to-speech with whatever the OS offers: macOS `say`, else espeak-ng. */
export async function narrate(text: string, outDir: string): Promise<string | undefined> {
  await mkdir(outDir, { recursive: true });
  const aiff = join(outDir, "voice.aiff");
  if ((await runProc("say", ["-r", "185", "-o", aiff, text])).code === 0 && existsSync(aiff)) return aiff;
  const wav = join(outDir, "voice.wav");
  if ((await runProc("espeak-ng", ["-s", "160", "-w", wav, text])).code === 0 && existsSync(wav)) return wav;
  return undefined;
}

async function duration(file: string): Promise<number> {
  const r = await runProc("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return Number.parseFloat(r.stdout) || 0;
}

/**
 * Produce `proof.mp4` and `proof.gif`. With a `before` recording the two are
 * placed side by side (bug on the left, fix on the right). The voiceover plays
 * over the MP4, holding the last frame until it ends; the GIF is silent and
 * small enough to render inline on GitHub.
 */
export async function renderMedia(
  videos: { before?: string; after: string },
  voice: string | undefined,
  outDir: string,
): Promise<{ mp4?: string; gif?: string }> {
  const mp4 = join(outDir, "proof.mp4");
  const gif = join(outDir, "proof.gif");
  const out: { mp4?: string; gif?: string } = {};

  const inputs = videos.before ? [videos.before, videos.after] : [videos.after];
  const lengths = await Promise.all(inputs.map(duration));
  const aDur = voice ? await duration(voice) : 0;
  const total = Math.max(...lengths, aDur) + 0.5;
  const padded = inputs.map((_, i) => `[${i}:v]scale=${videos.before ? 960 : 1280}:-2,tpad=stop_mode=clone:stop_duration=${total.toFixed(2)}[v${i}]`);
  const filter = videos.before ? `${padded.join(";")};[v0][v1]hstack=inputs=2[v]` : `${padded[0].replace("[v0]", "[v]")}`;

  const args = ["-y", ...inputs.flatMap((f) => ["-i", f])];
  if (voice) args.push("-i", voice);
  args.push("-filter_complex", filter, "-map", "[v]");
  if (voice) args.push("-map", `${inputs.length}:a`, "-c:a", "aac");
  args.push("-t", total.toFixed(2), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", mp4);
  if ((await runProc("ffmpeg", args, { timeoutMs: 5 * 60_000 })).code === 0) out.mp4 = mp4;

  const gifWidth = videos.before ? 960 : 720;
  const gifSource = out.mp4 ?? videos.after;
  const gifArgs = ["-y", "-t", String(Math.min(25, Math.max(...lengths) + 1)), "-i", gifSource, "-vf", `fps=8,scale=${gifWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse`, "-loop", "0", gif];
  if ((await runProc("ffmpeg", gifArgs, { timeoutMs: 5 * 60_000 })).code === 0) out.gif = gif;
  return out;
}

export function narrationText(o: { issueTitle: string; issueRef?: string; summary: string; testFiles: string[]; sourceFiles: string[]; sideBySide?: boolean }): string {
  const files = o.sourceFiles.slice(0, 3).map((f) => f.split("/").pop()).join(", ");
  return [
    `Hi, I'm Ghost Engineer.`,
    `This is a fix for ${o.issueRef ?? "the issue"}: ${o.issueTitle}.`,
    `First I wrote a test that reproduced the bug, and confirmed it failed.`,
    `${o.summary.replace(/\.$/, "")}.`,
    files ? `The change is in ${files}.` : "",
    `With the fix, the new test and the full test suite pass.`,
    o.sideBySide ? `On the left is the original bug. On the right, the same steps with the fix.` : `Here it is working.`,
  ].filter(Boolean).join(" ");
}

export async function fileBase64(path: string): Promise<string> {
  return (await readFile(path)).toString("base64");
}

export { shq };
