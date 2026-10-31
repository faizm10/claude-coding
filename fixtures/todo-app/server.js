import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

createServer(async (req, res) => {
  const path = req.url === "/" ? "/public/index.html" : normalize(req.url.split("?")[0]);
  if (!path.startsWith("/public/") && !path.startsWith("/src/")) return res.writeHead(404).end();
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": types[extname(path)] ?? "text/plain" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(Number(process.env.PORT ?? 4173), () => console.log("todo app ready"));
