// Artifact transport: every game is one document in the artifact's shared store
// (games/<CODE>). Each client runs the rules engine itself and saves the result,
// holding a short lease on the document so two players never write at once.
function createArtifactTransport() {
  const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const STALE_MS = 6 * 60 * 60 * 1000;
  const holder = "t" + Math.random().toString(36).slice(2);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const saved = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        if (v == null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      } catch {}
    },
  };

  let emit = () => {};
  let db = null;
  let uid = null;
  let defaultName = saved.get("p10-name") || "";
  let code = saved.get("p10-code");
  let games = [];
  let current = null; // latest game state for `code`
  let unsubGame = null;
  let botTimer = null;

  // Everyone at the table offers to play a waiting bot's turn; the lease and the
  // version check make sure only one of them actually does.
  function scheduleBot() {
    clearTimeout(botTimer);
    if (!current || !botToMove(current)) return;
    const seq = current.seq;
    const gameCode = code;
    botTimer = setTimeout(() => {
      withLease(gameCode, (s) => (s && botToMove(s) && s.seq === seq ? safeBotTurn(s) : s)).catch(() => {});
    }, BOT_DELAY_MS + Math.random() * 600);
  }

  function publish() {
    if (code && current) {
      emit({ screen: "game", code, view: viewFor(current, uid) });
      scheduleBot();
      return;
    }
    if (code) return emit({ screen: "loading", message: "Opening your game…" });
    const now = Date.now();
    const list = games
      .filter((g) => g.state && now - g.updated < STALE_MS && g.state.players.some((p) => !p.bot))
      .filter((g) => g.state.status === "lobby" || g.state.players.some((p) => p.id === uid))
      .filter((g) => g.state.status !== "finished")
      .map((g) => ({
        code: g.code,
        hostName: (g.state.players.find((p) => p.id === g.state.host) || g.state.players[0] || {}).name || "Someone",
        players: g.state.players.length,
        mine: g.state.players.some((p) => p.id === uid),
      }));
    emit({ screen: "home", defaultName, games: list });
  }

  function watchGame(next) {
    if (unsubGame) unsubGame();
    unsubGame = null;
    clearTimeout(botTimer);
    code = next;
    current = null;
    saved.set("p10-code", code);
    if (!code) return publish();
    unsubGame = db.doc("games/" + code).onSnapshot(
      (snap) => {
        const data = snap.exists ? snap.data() : null;
        if (!data || !data.state || !data.state.players.some((p) => p.id === uid)) {
          // The game is gone or we were removed from it.
          return watchGame(null);
        }
        current = data.state;
        publish();
      },
      () => watchGame(null)
    );
    publish();
  }

  // Read-modify-write under a short lease. `change` gets the current state
  // (or null) and returns the next one; engine errors propagate to the UI.
  async function withLease(gameCode, change) {
    const ref = db.doc("games/" + gameCode);
    let lease = null;
    for (let i = 0; i < 20; i++) {
      lease = await ref.acquire({ holder, ttlMs: 1500 });
      if (lease.acquired) break;
      await sleep(150 + Math.random() * 150);
    }
    if (!lease || !lease.acquired) throw new Error("The table is busy. Try again.");
    const snap = await ref.get();
    const before = snap.exists && snap.data().state ? snap.data().state : null;
    const state = change(before);
    if (state === before) return state;
    await ref.set({ code: gameCode, state, updated: Date.now() });
    return state;
  }

  function writeError(e) {
    if (e && e.code === "invalid_argument") return new Error("You can watch but not play yet. Ask the owner to invite you to this page by email as an Editor.");
    if (e && e.code === "quota_exceeded") return new Error("This page has run out of room for new games. Ask the owner to clear old ones.");
    return e;
  }

  return {
    listsGames: true,
    shareHint: () => "Friends open this same page and tap Join under Open tables.",
    async init(fn) {
      emit = fn;
      emit({ screen: "loading", message: "Connecting…" });
      const [dbApi, userApi] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
      db = dbApi;
      uid = userApi ? await userApi.id() : null;
      if (!db || !uid) {
        return emit({ screen: "unavailable", message: "Sign in to claude.ai and open this page from your invite to play with friends." });
      }
      if (!defaultName && userApi) defaultName = ((await userApi.me()).name || "").split(" ")[0];
      db.collection("games")
        .orderBy("updated", "desc")
        .limit(30)
        .onSnapshot(
          (snap) => {
            games = snap.docs.map((d) => d.data());
            if (!code) publish();
          },
          () => {}
        );
      watchGame(code);
    },
    async createGame(name) {
      saved.set("p10-name", name);
      defaultName = name;
      for (let i = 0; i < 8; i++) {
        const c = Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
        let created = false;
        try {
          await withLease(c, (s) => {
            if (s) return s; // code taken, try another
            created = true;
            return createGame(uid, name);
          });
        } catch (e) {
          throw writeError(e);
        }
        if (created) return watchGame(c);
      }
      throw new Error("Couldn't create a game. Try again.");
    },
    async joinGame(c, name) {
      if (name) {
        saved.set("p10-name", name);
        defaultName = name;
      }
      try {
        await withLease(c, (s) => {
          if (!s) throw new Error("That game no longer exists.");
          return applyAction(s, uid, { type: "join", name });
        });
      } catch (e) {
        throw writeError(e);
      }
      watchGame(c);
    },
    async act(action) {
      try {
        current = await withLease(code, (s) => {
          if (!s) throw new Error("That game no longer exists.");
          return applyAction(s, uid, action);
        });
      } catch (e) {
        throw writeError(e);
      }
      publish();
    },
    async leave() {
      if (current && current.status === "lobby") {
        const leaving = code;
        await withLease(leaving, (s) => (s ? applyAction(s, uid, { type: "leave" }) : s)).catch(() => {});
      }
      watchGame(null);
    },
  };
}
