import { describe, expect, it } from "vitest";
import { pythonFor, rowToTask } from "../src/swebench.js";

const base = {
  instance_id: "x__y-1",
  base_commit: "abc",
  problem_statement: "Title line\nMore detail here.",
  PASS_TO_PASS: "[]",
};

describe("rowToTask", () => {
  it("maps pytest node ids", () => {
    const t = rowToTask({
      ...base,
      repo: "astropy/astropy",
      test_patch: "diff --git a/astropy/modeling/tests/test_sep.py b/astropy/modeling/tests/test_sep.py\n",
      FAIL_TO_PASS: JSON.stringify(["astropy/modeling/tests/test_sep.py::test_a[1]"]),
    });
    expect(t).toMatchObject({ id: "x__y-1", repo: "https://github.com/astropy/astropy.git", baseCommit: "abc", title: "Title line", body: "More detail here." });
    expect(t.grade).toBe("python -m pytest -q -p no:cacheprovider 'astropy/modeling/tests/test_sep.py::test_a[1]'");
    expect(t.test).toContain("astropy/modeling/tests");
  });

  it("maps django test labels", () => {
    const t = rowToTask({
      ...base,
      repo: "django/django",
      test_patch: "diff --git a/tests/forms_tests/tests/test_x.py b/tests/forms_tests/tests/test_x.py\n",
      FAIL_TO_PASS: JSON.stringify(["test_clean (forms_tests.tests.test_x.FormTests)"]),
    });
    expect(t.grade).toBe("python tests/runtests.py --verbosity 1 'forms_tests.tests.test_x.FormTests.test_clean'");
    expect(t.test).toBe("python tests/runtests.py --verbosity 1 forms_tests");
  });

  it("falls back to -k selection for bare test names", () => {
    const t = rowToTask({
      ...base,
      repo: "sympy/sympy",
      test_patch: "diff --git a/sympy/core/tests/test_basic.py b/sympy/core/tests/test_basic.py\n",
      FAIL_TO_PASS: JSON.stringify(["test_a", "test_b"]),
    });
    expect(t.grade).toBe("python -m pytest -q -p no:cacheprovider sympy/core/tests/test_basic.py -k 'test_a or test_b'");
  });
});

describe("python versions", () => {
  it("picks interpreters per repo/version and installs into an isolated venv", () => {
    expect(pythonFor("django/django", "4.2")).toBe("3.9");
    expect(pythonFor("django/django", "5.0")).toBe("3.11");
    expect(pythonFor("sympy/sympy", "1.12")).toBe("3.9");
    const t = rowToTask({ ...base, repo: "django/django", version: "5.0", test_patch: "", FAIL_TO_PASS: "[]" });
    expect(t.install).toContain("uv venv -q --allow-existing -p 3.11 .venv");
  });
});
