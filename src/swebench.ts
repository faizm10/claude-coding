import { dirname } from "node:path";
import type { EvalTask, Suite } from "./eval.js";

const API = "https://datasets-server.huggingface.co/rows";
const DATASET = "princeton-nlp/SWE-bench_Verified";

/**
 * Python version per repo/version, following the SWE-bench harness specs
 * (approximate; tasks whose interpreter can't be provisioned end as env_setup).
 */
export function pythonFor(repo: string, version?: string): string {
  const v = Number.parseFloat(version ?? "0");
  if (repo === "django/django") return v >= 5 ? "3.11" : v >= 4 ? "3.9" : "3.8";
  if (repo === "scikit-learn/scikit-learn") return v >= 1 ? "3.9" : "3.8";
  if (repo === "pydata/xarray") return "3.10";
  if (repo === "matplotlib/matplotlib") return "3.11";
  return "3.9";
}

/** Repos that install without compiling C extensions; best for a first benchmark. */
export const PURE_PYTHON_REPOS = ["django/django", "sympy/sympy", "pytest-dev/pytest", "sphinx-doc/sphinx", "psf/requests", "pylint-dev/pylint", "pallets/flask", "mwaskom/seaborn", "pydata/xarray"];

export interface SwebenchRow {
  repo: string;
  instance_id: string;
  base_commit: string;
  problem_statement: string;
  test_patch: string;
  FAIL_TO_PASS: string;
  PASS_TO_PASS: string;
  difficulty?: string;
  version?: string;
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function patchFiles(patch: string): string[] {
  return [...patch.matchAll(/^diff --git a\/(\S+) b\//gm)].map((m) => m[1]);
}

/** Convert one dataset row into a task graded by its FAIL_TO_PASS tests. */
export function rowToTask(row: SwebenchRow): EvalTask {
  const failToPass: string[] = JSON.parse(row.FAIL_TO_PASS);
  const files = patchFiles(row.test_patch);
  const [title, ...rest] = row.problem_statement.trim().split("\n");

  let grade: string;
  let test: string;
  if (row.repo === "django/django") {
    // "test_name (module.Class)" -> "module.Class.test_name"
    const labels = failToPass.map((t) => {
      const m = t.match(/^(\S+) \(([\w.]+)\)/);
      return m ? `${m[2]}.${m[1]}` : t;
    });
    const apps = [...new Set(files.map((f) => f.split("/")[1]).filter(Boolean))];
    grade = `python tests/runtests.py --verbosity 1 ${labels.map(shellQuote).join(" ")}`;
    test = `python tests/runtests.py --verbosity 1 ${apps.join(" ")}`;
  } else if (failToPass.every((t) => t.includes("::"))) {
    grade = `python -m pytest -q -p no:cacheprovider ${failToPass.map(shellQuote).join(" ")}`;
    test = `python -m pytest -q -p no:cacheprovider ${[...new Set(files.map((f) => dirname(f)))].join(" ")}`;
  } else {
    // Bare test names (e.g. sympy): select them by keyword within the touched test files.
    grade = `python -m pytest -q -p no:cacheprovider ${files.join(" ")} -k ${shellQuote(failToPass.join(" or "))}`;
    test = `python -m pytest -q -p no:cacheprovider ${[...new Set(files.map((f) => dirname(f)))].join(" ")}`;
  }

  return {
    id: row.instance_id,
    repo: `https://github.com/${row.repo}.git`,
    baseCommit: row.base_commit,
    title: title.slice(0, 200),
    body: rest.join("\n").trim() || title,
    // Isolated per-task venv with the interpreter this repo/version expects.
    install: `uv venv -q --allow-existing -p ${pythonFor(row.repo, row.version)} .venv && uv pip install -q -p .venv -e . pytest`,
    test,
    testPatch: row.test_patch,
    grade,
    maxMinutes: 30,
    tags: [row.repo, row.difficulty ?? "unknown"],
  };
}

export async function importSwebench(o: { limit: number; difficulty?: string; repos?: string[]; purePython?: boolean }): Promise<Suite> {
  const repos = o.repos ?? (o.purePython ? PURE_PYTHON_REPOS : undefined);
  const tasks: EvalTask[] = [];
  for (let offset = 0; tasks.length < o.limit && offset < 500; offset += 100) {
    const url = `${API}?dataset=${encodeURIComponent(DATASET)}&config=default&split=test&offset=${offset}&length=100`;
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`dataset API ${res.status}: ${await res.text()}`);
    const page = (await res.json()) as { rows: { row: SwebenchRow }[] };
    for (const { row } of page.rows) {
      if (o.difficulty && row.difficulty !== o.difficulty) continue;
      if (repos && !repos.includes(row.repo)) continue;
      tasks.push(rowToTask(row));
      if (tasks.length >= o.limit) break;
    }
    if (page.rows.length < 100) break;
  }
  const filters = [o.difficulty, o.purePython && !o.repos ? "pure-Python repos" : o.repos?.join(",")].filter(Boolean).join(", ");
  return {
    name: `swebench-verified-${tasks.length}`,
    description: `${tasks.length} tasks from SWE-bench Verified${filters ? ` (${filters})` : ""}. Python environments vary per repo; env_setup failures are reported separately.`,
    tasks,
  };
}
