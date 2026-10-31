let nextId = 1;

export function addTodo(list, text) {
  const trimmed = text.trim();
  if (!trimmed) return list;
  return [...list, { id: nextId++, text: trimmed, done: false }];
}

export function toggle(list, id) {
  return list.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
}

/** How many todos are still to do. */
export function remaining(list) {
  return list.filter((t) => t.done).length;
}

export function clearCompleted(list) {
  return list.filter((t) => !t.done);
}
