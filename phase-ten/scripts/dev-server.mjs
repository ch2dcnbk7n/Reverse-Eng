// Local preview: serves public/ and the API with an in-memory store.
// Usage: node scripts/dev-server.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "../server/handler.js";
import { createMemoryStore } from "../server/memory-store.js";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const port = Number(process.argv[2]) || 8888;
const handle = createHandler(createMemoryStore());
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith("/api/")) {
    const body = req.method === "POST" ? await new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); }) : undefined;
    const out = await handle(new Request(url, { method: req.method, body }));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    return res.end(await out.text());
  }
  const path = normalize(join(root, url.pathname === "/" ? "index.html" : url.pathname));
  if (!path.startsWith(root)) return res.writeHead(403).end();
  try {
    const data = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" }).end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`Phase Ten on http://localhost:${port}`));
