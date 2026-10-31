import type { Issue } from "./types.js";
import { runProc } from "./util/proc.js";

export function parseIssueUrl(url: string): { owner: string; repo: string; number: number } {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/) ?? url.match(/^([^/\s]+)\/([^#\s]+)#(\d+)$/);
  if (!m) throw new Error(`not a GitHub issue URL or owner/repo#N: ${url}`);
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

async function gh(args: string[], input?: string): Promise<string> {
  const res = await runProc("gh", args, { input, timeoutMs: 120_000 });
  if (res.code !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${res.stderr.trim()}`);
  return res.stdout;
}

export async function ghApi<T = any>(path: string, opts: { method?: string; fields?: Record<string, string> } = {}): Promise<T> {
  const args = ["api", path];
  if (opts.method) args.push("-X", opts.method);
  for (const [k, v] of Object.entries(opts.fields ?? {})) args.push("-f", `${k}=${v}`);
  const out = await gh(args);
  return (out.trim() ? JSON.parse(out) : {}) as T;
}

export async function fetchIssue(url: string): Promise<Issue> {
  const { owner, repo, number } = parseIssueUrl(url);
  const [issue, meta] = await Promise.all([
    ghApi(`repos/${owner}/${repo}/issues/${number}`),
    ghApi(`repos/${owner}/${repo}`),
  ]);
  if (issue.pull_request) throw new Error(`${owner}/${repo}#${number} is a pull request, not an issue`);
  return {
    owner,
    repo,
    number,
    title: issue.title,
    body: issue.body ?? "",
    labels: (issue.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
    state: issue.state,
    url: issue.html_url,
    cloneUrl: meta.clone_url,
    defaultBranch: meta.default_branch,
  };
}

export async function listLabeledIssues(repo: string, label: string): Promise<string[]> {
  const out = await gh(["issue", "list", "--repo", repo, "--label", label, "--state", "open", "--json", "url", "--limit", "100"]);
  return (JSON.parse(out) as { url: string }[]).map((i) => i.url);
}

export async function viewerLogin(): Promise<string> {
  return (await gh(["api", "user", "--jq", ".login"])).trim();
}

export async function canPush(owner: string, repo: string): Promise<boolean> {
  const meta = await ghApi(`repos/${owner}/${repo}`);
  return Boolean(meta.permissions?.push);
}

/** Ensure the viewer has a fork and return its owner/name. */
export async function ensureFork(owner: string, repo: string): Promise<{ owner: string; repo: string }> {
  const fork = await ghApi(`repos/${owner}/${repo}/forks`, { method: "POST" });
  return { owner: fork.owner.login, repo: fork.name };
}

export async function createPullRequest(opts: {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
}): Promise<string> {
  const args = ["pr", "create", "--repo", `${opts.owner}/${opts.repo}`, "--head", opts.head, "--base", opts.base, "--title", opts.title, "--body-file", "-"];
  if (opts.draft) args.push("--draft");
  return (await gh(args, opts.body)).trim();
}

export async function commentOnIssue(owner: string, repo: string, number: number, body: string) {
  await gh(["issue", "comment", String(number), "--repo", `${owner}/${repo}`, "--body-file", "-"], body);
}

/**
 * Upload a media file to a `ghost-media` branch through the contents API and
 * return a URL that renders inline in PR descriptions.
 */
export async function uploadMedia(owner: string, repo: string, path: string, base64: string): Promise<string> {
  const branch = "ghost-media";
  try {
    await ghApi(`repos/${owner}/${repo}/branches/${branch}`);
  } catch {
    const meta = await ghApi(`repos/${owner}/${repo}`);
    const head = await ghApi(`repos/${owner}/${repo}/git/ref/heads/${meta.default_branch}`);
    await ghApi(`repos/${owner}/${repo}/git/refs`, { method: "POST", fields: { ref: `refs/heads/${branch}`, sha: head.object.sha } });
  }
  await ghApi(`repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    fields: { message: `ghost: add ${path}`, content: base64, branch },
  });
  return `https://github.com/${owner}/${repo}/blob/${branch}/${path}?raw=true`;
}
