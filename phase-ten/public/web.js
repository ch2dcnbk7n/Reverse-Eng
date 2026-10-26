// Website transport: talks to the Netlify function and polls for updates.
import { mountApp } from "./ui.js";

const POLL_MS = 1500;
const GIVE_UP_AFTER = 3; // failed polls before telling the player
const saved = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

async function api(path, body) {
  const res = await fetch(`/api/${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Couldn't reach the game server. Check your connection.");
    err.status = res.status;
    throw err;
  }
  return data;
}

function createWebTransport() {
  let emit = () => {};
  let session = saved.get("p10-session"); // {code, token}
  let view = null;
  let timer = null;
  let failures = 0;
  const params = new URLSearchParams(location.search);
  const prefillCode = (params.get("room") || "").toUpperCase();

  const home = () => emit({ screen: "home", defaultName: saved.get("p10-name") || "", prefillCode });
  const show = (v) => {
    view = v;
    emit({ screen: "game", code: session.code, view, offline: false });
  };

  async function poll() {
    clearTimeout(timer);
    if (!session) return;
    try {
      const q = new URLSearchParams({ code: session.code, token: session.token, seq: view ? view.seq : -1 });
      const data = await api(`state?${q}`);
      const wasOffline = failures >= GIVE_UP_AFTER;
      failures = 0;
      if (data.view) show(data.view);
      else if (wasOffline) show(view);
    } catch (e) {
      if (e.status === 403 || e.status === 404) {
        session = null;
        saved.set("p10-session", null);
        view = null;
        return home();
      }
      failures++;
      if (failures >= GIVE_UP_AFTER) {
        // Rejoining: stop and offer a way out. Mid-game: keep trying and say so.
        if (!view) return emit({ screen: "lost", code: session.code });
        emit({ screen: "game", code: session.code, view, offline: true });
      }
    }
    timer = setTimeout(poll, document.hidden ? POLL_MS * 4 : POLL_MS);
  }

  async function enter(res, name) {
    saved.set("p10-name", name);
    session = { code: res.code, token: res.token };
    saved.set("p10-session", session);
    view = null;
    if (prefillCode) history.replaceState(null, "", location.pathname);
    await poll();
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poll();
  });

  return {
    listsGames: false,
    shareUrl: (code) => `${location.origin}${location.pathname}?room=${code}`,
    shareHint: () => "Send friends the invite link, or have them enter this code.",
    retry() {
      failures = 0;
      emit({ screen: "loading", message: "Rejoining your game…" });
      poll();
    },
    init(fn) {
      emit = fn;
      if (session && (!prefillCode || prefillCode === session.code)) {
        emit({ screen: "loading", message: "Rejoining your game…" });
        poll();
      } else {
        session = null;
        home();
      }
    },
    async createGame(name) {
      await enter(await api("create", { name }), name);
    },
    async joinGame(code, name) {
      await enter(await api("join", { code, name }), name);
    },
    async act(action) {
      const data = await api("act", { code: session.code, token: session.token, action });
      show(data.view);
    },
    async leave() {
      if (view && view.status === "lobby") {
        await api("act", { code: session.code, token: session.token, action: { type: "leave" } }).catch(() => {});
      }
      clearTimeout(timer);
      session = null;
      view = null;
      saved.set("p10-session", null);
      home();
    },
  };
}

// The hosted site gets Netlify's "Powered by Netlify" badge in the bottom
// corner; the stylesheet keeps the hand clear of it on phones.
document.documentElement.classList.add("hosted");
mountApp(document.getElementById("app"), createWebTransport());
