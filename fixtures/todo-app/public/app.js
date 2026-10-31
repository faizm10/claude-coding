import { addTodo, clearCompleted, remaining, toggle } from "/src/todo.js";

let todos = [];
const $ = (s) => document.querySelector(s);

function render() {
  $("#list").innerHTML = "";
  for (const t of todos) {
    const li = document.createElement("li");
    li.innerHTML = `<label><input type="checkbox" ${t.done ? "checked" : ""}> <span></span></label>`;
    li.querySelector("span").textContent = t.text;
    li.className = t.done ? "done" : "";
    li.querySelector("input").addEventListener("change", () => {
      todos = toggle(todos, t.id);
      render();
    });
    $("#list").append(li);
  }
  const n = remaining(todos);
  $("#count").textContent = `${n} ${n === 1 ? "item" : "items"} left`;
}

$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  todos = addTodo(todos, $("#new").value);
  $("#new").value = "";
  render();
});
$("#clear").addEventListener("click", () => {
  todos = clearCompleted(todos);
  render();
});
render();
