// HTTP API for the hosted game. The server owns the deck and every hand; each
// player only ever receives viewFor(state, theirId).
//
//   POST /api/create {name}                 -> {code, token}
//   POST /api/join   {code, name}           -> {code, token}
//   GET  /api/state?code=&token=&seq=       -> {view} or {unchanged: true}
//   POST /api/act    {code, token, action}  -> {view}
import { randomBytes, randomInt } from "node:crypto";
import { createGame, applyAction, viewFor, GameError } from "../public/engine.js";

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O, they read like 1 and 0
const GAME_TTL_MS = 3 * 24 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const rng = () => randomInt(0, 2 ** 32) / 2 ** 32;
const newCode = () => Array.from({ length: 5 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join("");
const newToken = () => randomBytes(18).toString("base64url");
const newPlayerId = () => "p_" + randomBytes(6).toString("hex");

// `store` needs getWithMetadata(key) -> {data, etag} | null and
// setJSON(key, value, {onlyIfNew | onlyIfMatch}) -> {modified}, as Netlify Blobs provides.
export function createHandler(store) {
  async function load(code) {
    const entry = await store.getWithMetadata(code, { type: "json", consistency: "strong" });
    if (!entry || !entry.data || entry.data.expires < Date.now()) throw new HttpError(404, "That room doesn't exist or has expired.");
    return entry;
  }

  // Optimistic concurrency: re-read and retry when another request saved first.
  async function update(code, change) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data, etag } = await load(code);
      const result = change(data);
      const doc = { ...data, state: result.state, expires: Date.now() + GAME_TTL_MS };
      const { modified } = await store.setJSON(code, doc, { onlyIfMatch: etag });
      if (modified) return { doc, ...result };
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
    }
    throw new HttpError(409, "The table is busy. Try again.");
  }

  function playerFor(doc, token) {
    const id = typeof token === "string" && Object.hasOwn(doc.tokens, token) ? doc.tokens[token] : null;
    if (!id) throw new HttpError(403, "You're not in this game. Join it with the room code.");
    return id;
  }

  const routes = {
    async create(body) {
      for (let i = 0; i < 10; i++) {
        const code = newCode();
        const token = newToken();
        const id = newPlayerId();
        const doc = { state: createGame(id, body.name), tokens: { [token]: id }, expires: Date.now() + GAME_TTL_MS };
        const { modified } = await store.setJSON(code, doc, { onlyIfNew: true });
        if (modified) return { code, token };
      }
      throw new HttpError(503, "Couldn't create a room. Try again.");
    },

    async join(body) {
      const code = String(body.code || "").toUpperCase();
      const token = newToken();
      const id = newPlayerId();
      await update(code, (doc) => {
        doc.tokens = { ...doc.tokens, [token]: id };
        return { state: applyAction(doc.state, id, { type: "join", name: body.name }, rng) };
      });
      return { code, token };
    },

    async state(_body, url) {
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      const { data } = await load(code);
      const id = playerFor(data, url.searchParams.get("token"));
      const seq = Number(url.searchParams.get("seq"));
      if (seq === data.state.seq) return { unchanged: true };
      return { view: viewFor(data.state, id) };
    },

    async act(body) {
      const code = String(body.code || "").toUpperCase();
      let id;
      const { doc } = await update(code, (data) => {
        id = playerFor(data, body.token);
        return { state: applyAction(data.state, id, body.action, rng) };
      });
      return { view: viewFor(doc.state, id) };
    },
  };

  return async function handle(req) {
    const url = new URL(req.url);
    const route = url.pathname.split("/").filter(Boolean).pop();
    const fn = Object.hasOwn(routes, route) ? routes[route] : null;
    if (!fn) return json({ error: "Not found." }, 404);
    if ((route === "state") !== (req.method === "GET")) return json({ error: "Method not allowed." }, 405);
    try {
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      return json(await fn(body, url));
    } catch (e) {
      if (e instanceof GameError) return json({ error: e.message }, 400);
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Server error. Try again." }, 500);
    }
  };
}
