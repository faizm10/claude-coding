import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport, loadSuite, reportMarkdown, runSuite } from "../src/eval.js";
import { FakeEngine } from "../src/engines/fake.js";
import { Store } from "../src/store.js";

const suite = await loadSuite(new URL("../suites/toy-shop.json", import.meta.url).pathname);

const CART_TEST = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '../src/cart.js';\ntest('qty', () => assert.equal(total([{ price: 10, quantity: 3 }]), 30));\n`;
const DISCOUNT_TEST = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { applyDiscount } from '../src/discount.js';\ntest('pct', () => assert.equal(applyDiscount(200, 25), 150));\n`;

/** One scripted "agent" per task: a real fix, a cheating fix, and doing nothing. */
const scripted = new FakeEngine(async (sb, task) => {
  const w = (p: string, s: string) => writeFile(join(sb.hostWorkdir, p), s);
  if (task.prompt.includes("Cart total ignores quantity")) {
    await w("test/cart.test.js", CART_TEST);
    await w("src/cart.js", "export function total(items) { return items.reduce((s, i) => s + i.price * i.quantity, 0); }\nexport function itemCount(items) { return items.reduce((n, i) => n + i.quantity, 0); }\n");
    return "SUMMARY: multiply price by quantity";
  }
  if (task.prompt.includes("applyDiscount")) {
    await w("test/discount.test.js", DISCOUNT_TEST);
    // Special-cases the example instead of fixing the math: passes the gate, fails hidden tests.
    await w("src/discount.js", "export function applyDiscount(price, percent) {\n  if (percent < 0 || percent > 100) throw new RangeError('x');\n  if (price === 200 && percent === 25) return 150;\n  return price - percent;\n}\n");
    return "SUMMARY: handle the reported case";
  }
  return "SUMMARY: nothing to do";
});

describe("eval harness on the toy-shop suite", () => {
  it("grades with hidden tests and classifies failures", async () => {
    const store = new Store(":memory:");
    await runSuite({ suite, engines: ["fake"], store, sandboxKind: "local", engineFactory: () => scripted });
    const runs = store.listRuns({ kind: "eval", suite: "toy-shop" });
    const byTask = Object.fromEntries(runs.map((r) => [r.target, r.outcome]));
    expect(byTask).toEqual({
      "toy-shop/cart-total": "resolved",
      "toy-shop/discount-percent": "wrong_fix",
      "toy-shop/slug-case": "no_change",
    });

    const [report] = buildReport(runs);
    expect(report).toMatchObject({ engine: "fake", tasks: 3, resolved: 1 });
    expect(report.resolveRate).toBeCloseTo(1 / 3);
    expect(report.gatePassRate).toBeCloseTo(2 / 3);
    const md = reportMarkdown("toy-shop", [report]);
    expect(md).toContain("| fake | 1/3 | **33.3%** |");
    expect(md).toContain("| wrong_fix | 1 |");
  });
});
