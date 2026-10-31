import test from "node:test";
import assert from "node:assert/strict";
import { addTodo, clearCompleted, toggle } from "../src/todo.js";

test("addTodo ignores blank text", () => {
  assert.equal(addTodo([], "   ").length, 0);
  assert.equal(addTodo([], "milk")[0].text, "milk");
});

test("toggle and clearCompleted", () => {
  let list = addTodo(addTodo([], "a"), "b");
  list = toggle(list, list[0].id);
  assert.equal(clearCompleted(list).length, 1);
});
