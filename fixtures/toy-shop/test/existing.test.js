import test from "node:test";
import assert from "node:assert/strict";
import { itemCount } from "../src/cart.js";
import { applyDiscount } from "../src/discount.js";
import { slugify } from "../src/slug.js";

test("itemCount sums quantities", () => {
  assert.equal(itemCount([{ price: 1, quantity: 2 }, { price: 5, quantity: 3 }]), 5);
});

test("applyDiscount rejects invalid percentages", () => {
  assert.throws(() => applyDiscount(10, 120), RangeError);
});

test("slugify joins words with dashes", () => {
  assert.equal(slugify("a b"), "a-b");
});
