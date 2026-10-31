/** "Hello,  World!" -> "hello-world" */
export function slugify(text) {
  return text
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
