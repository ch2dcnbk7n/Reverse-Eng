// Phase Ten table UI. Renders whatever the transport reports and sends player
// actions back through it, so the same screen runs on the website (server
// transport) and in the Claude artifact (shared-store transport).
import { PHASES, describePhase, MAX_PLAYERS } from "./engine.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const COLOR_ORDER = { red: 0, blue: 1, green: 2, yellow: 3 };
const phaseSize = (phase) => (PHASES[phase - 1] || []).reduce((t, g) => t + g.size, 0);

function cardHtml(card, { selected = false, attrs = "", small = false } = {}) {
  const cls = card.kind === "n" ? `c-${card.c}` : card.kind;
  const face = card.kind === "wild" ? "W" : card.kind === "skip" ? "S" : card.n;
  const sub = card.kind === "wild" ? "Wild" : card.kind === "skip" ? "Skip" : card.c;
  // Small cards sit inside a group button, so they render as spans.
  const tag = small ? "span" : "button";
  return `<${tag} ${small ? "" : 'type="button" '}class="card ${cls}${selected ? " sel" : ""}${small ? " small" : ""}" ${attrs}
    aria-label="${esc(card.kind === "n" ? `${card.c} ${card.n}` : sub)}${selected ? ", selected" : ""}">
    <span class="face">${esc(face)}</span><span class="sub">${esc(sub)}</span></${tag}>`;
}

export function mountApp(root, transport) {
  const ui = { snap: { screen: "loading" }, selected: [], sort: "number", toast: "", busy: false, skipPick: false };
  try {
    ui.sort = localStorage.getItem("p10-sort") || "number";
  } catch {}

  function setToast(msg) {
    ui.toast = msg;
    render();
    clearTimeout(setToast.t);
    if (msg) setToast.t = setTimeout(() => setToast(""), 4000);
  }

  async function run(fn) {
    if (ui.busy) return;
    ui.busy = true;
    render();
    try {
      await fn();
    } catch (e) {
      setToast(e && e.message ? e.message : "Something went wrong. Try again.");
    } finally {
      ui.busy = false;
      render();
    }
  }

  // On success, clear only the selection the action used: the update can render
  // before this resolves, and the player may already have tapped new cards.
  const act = (action) => {
    const used = ui.selected.slice();
    return run(async () => {
      await transport.act(action);
      ui.selected = ui.selected.filter((id) => !used.includes(id));
      ui.skipPick = false;
    });
  };

  transport.init((snap) => {
    ui.snap = snap;
    // Drop selections for cards that left the hand.
    const me = snap.view && snap.view.players.find((p) => p.id === snap.view.me);
    if (me && me.hand) ui.selected = ui.selected.filter((id) => me.hand.some((c) => c.id === id));
    render();
  });

  // ---------- screens ----------

  function homeHtml() {
    const s = ui.snap;
    const nameVal = esc(ui.name ?? s.defaultName ?? "");
    const games = s.games || [];
    const joinBlock = transport.listsGames
      ? `<section class="panel">
          <h2>Open games</h2>
          ${
            games.length
              ? `<ul class="games">${games
                  .map(
                    (g) => `<li><div><strong>${esc(g.hostName)}'s table</strong>
                      <span class="muted">${g.players}/${MAX_PLAYERS} players · code ${esc(g.code)}</span></div>
                      <button type="button" class="btn" data-join="${esc(g.code)}"${g.mine ? " data-mine" : ""}>${g.mine ? "Rejoin" : "Join"}</button></li>`
                  )
                  .join("")}</ul>`
              : `<p class="muted">No one is waiting yet. Create a game and tell your friends to open this page.</p>`
          }
        </section>`
      : `<section class="panel">
          <h2>Join a friend</h2>
          <form id="join-form" class="row">
            <label class="grow"><span class="lbl">Room code</span>
              <input id="join-code" autocomplete="off" maxlength="5" placeholder="ABCDE" value="${esc(ui.code ?? s.prefillCode ?? "")}"></label>
            <button class="btn" type="submit">Join</button>
          </form>
        </section>`;
    return `<header class="hero">
        <h1>Phase Ten</h1>
        <p>Ten phases. 2 to ${MAX_PLAYERS} players. First to finish Phase 10 with the lowest score wins.</p>
      </header>
      <section class="panel">
        <label><span class="lbl">Your name</span>
          <input id="name" maxlength="20" autocomplete="nickname" value="${nameVal}" placeholder="What should friends call you?"></label>
        <button type="button" class="btn primary" data-do="create">Create a game</button>
      </section>
      ${joinBlock}
      <details class="panel rules"><summary>How to play</summary>${rulesHtml()}</details>`;
  }

  function rulesHtml() {
    return `<ol class="phase-list">${PHASES.map((_, i) => `<li>${esc(describePhase(i + 1))}</li>`).join("")}</ol>
      <p>On your turn, draw from the deck or the discard pile. If you can, lay down your whole phase at once.
      After your phase is down you can add cards to any group on the table. End your turn by discarding.
      A Wild stands in for any card. A Skip makes a player of your choice miss their next turn.</p>
      <p>The hand ends when someone runs out of cards. Everyone who laid down their phase moves to the next one.
      Cards left in hand score: 1–9 are 5 points, 10–12 are 10, Skip 15, Wild 25.</p>`;
  }

  function lobbyHtml(v) {
    const isHost = v.host === v.me;
    return `<section class="panel lobby">
        <p class="lbl">Room code</p>
        <p class="code">${esc(ui.snap.code)}</p>
        ${transport.shareHint ? `<p class="muted">${esc(transport.shareHint(ui.snap.code))}</p>` : ""}
        ${transport.shareUrl ? `<button type="button" class="btn" data-do="copy">Copy invite link</button>` : ""}
      </section>
      <section class="panel">
        <h2>Players (${v.players.length}/${MAX_PLAYERS})</h2>
        <ul class="players-list">${v.players
          .map(
            (p) => `<li><span>${esc(p.name)}${p.id === v.host ? ' <span class="tag">Host</span>' : ""}${p.id === v.me ? ' <span class="tag">You</span>' : ""}</span>
              ${isHost && p.id !== v.me ? `<button type="button" class="link" data-kick="${esc(p.id)}">Remove</button>` : ""}</li>`
          )
          .join("")}</ul>
        ${
          isHost
            ? `<button type="button" class="btn primary" data-do="start" ${v.players.length < 2 ? "disabled" : ""}>
                ${v.players.length < 2 ? "Waiting for at least one more player" : `Start with ${v.players.length} players`}</button>`
            : `<p class="muted">Waiting for ${esc(v.players.find((p) => p.id === v.host)?.name || "the host")} to start.</p>`
        }
        <button type="button" class="link" data-do="leave">Leave game</button>
      </section>`;
  }

  function sortedHand(hand) {
    const h = hand.slice();
    const rank = (c) => (c.kind === "wild" ? 100 : c.kind === "skip" ? 200 : 0);
    if (ui.sort === "color") {
      h.sort((a, b) => rank(a) - rank(b) || COLOR_ORDER[a.c] - COLOR_ORDER[b.c] || a.n - b.n);
    } else {
      h.sort((a, b) => rank(a) - rank(b) || a.n - b.n || COLOR_ORDER[a.c] - COLOR_ORDER[b.c]);
    }
    return h;
  }

  function gameHtml(v) {
    const me = v.players.find((p) => p.id === v.me);
    const turnP = v.players[v.turn];
    const myTurn = v.status === "playing" && turnP.id === v.me;
    const sel = ui.selected;
    const top = v.discard[0];
    const canDraw = myTurn && v.step === "draw" && !ui.busy;
    const need = phaseSize(me.phase);
    const selCards = sel.map((id) => me.hand.find((c) => c.id === id)).filter(Boolean);
    const canLay = myTurn && v.step === "play" && !me.laid && sel.length === need;
    const canDiscard = myTurn && v.step === "play" && sel.length === 1;
    const canHit = myTurn && v.step === "play" && me.laid && sel.length === 1;

    let status;
    if (v.status !== "playing") status = "Hand over";
    else if (!myTurn) status = `${esc(turnP.name)} is playing…`;
    else if (v.step === "draw") status = "Your turn. Draw from the deck or the discard pile.";
    else if (!me.laid) status = `Lay down Phase ${me.phase} if you can, then discard one card.`;
    else status = "Add cards to groups on the table, then discard one card.";

    const players = v.players
      .map((p, i) => {
        const tags = [
          i === v.turn && v.status === "playing" ? '<span class="tag on">Turn</span>' : "",
          p.skipped ? '<span class="tag warn">Skipped next</span>' : "",
          p.laid ? '<span class="tag ok">Phase down</span>' : "",
          i === v.dealer ? '<span class="tag">Dealer</span>' : "",
        ].join("");
        return `<li class="pl${i === v.turn ? " active" : ""}${p.id === v.me ? " me" : ""}">
          <div class="pl-top"><strong>${esc(p.name)}${p.id === v.me ? " (you)" : ""}</strong><span class="ph">P${Math.min(p.phase, 10)}</span></div>
          <div class="pl-meta"><span>${p.score} pts</span><span>${p.handCount} cards</span></div>
          <div class="tags">${tags}</div></li>`;
      })
      .join("");

    const owners = v.players.filter((p) => v.table.some((g) => g.owner === p.id));
    const table = owners.length
      ? owners
          .map(
            (p) => `<div class="owner"><p class="lbl">${esc(p.name)} · Phase ${p.phase}</p><div class="groups">${v.table
              .map((g, gi) => (g.owner !== p.id ? "" : groupHtml(g, gi, canHit)))
              .join("")}</div></div>`
          )
          .join("")
      : `<p class="muted empty">No phases on the table yet.</p>`;

    let actions = "";
    if (myTurn && v.step === "play") {
      const skipSel = selCards.length === 1 && selCards[0].kind === "skip";
      const targets = v.players.filter((p) => p.id !== v.me && !p.skipped);
      if (ui.skipPick && skipSel && v.players.length > 2) {
        actions = `<div class="pick"><span>Skip who?</span>${targets
          .map((p) => `<button type="button" class="btn" data-skip="${esc(p.id)}">${esc(p.name)}</button>`)
          .join("")}<button type="button" class="link" data-do="cancel-skip">Cancel</button></div>`;
      } else {
        actions = `
          ${!me.laid ? `<button type="button" class="btn primary" data-do="lay" ${canLay ? "" : "disabled"}>Lay down Phase ${me.phase} (${sel.length}/${need})</button>` : ""}
          <button type="button" class="btn" data-do="discard" ${canDiscard ? "" : "disabled"}>${skipSel ? "Discard Skip" : "Discard"}</button>
          ${canHit ? `<span class="muted">Or tap a group on the table to add this card.</span>` : ""}`;
      }
    }

    return `<div class="topbar">
        <span class="lbl">Room ${esc(ui.snap.code)} · Hand ${v.handNo}</span>
        <button type="button" class="link" data-do="leave">Leave</button>
      </div>
      <ul class="players">${players}</ul>
      <section class="center">
        <div class="piles">
          <button type="button" class="pile deck" data-draw="deck" ${canDraw ? "" : "disabled"} aria-label="Draw from deck, ${v.deckCount} cards">
            <span class="face">Deck</span><span class="sub">${v.deckCount} left</span></button>
          ${
            top
              ? cardHtml(top, { attrs: `data-draw="discard" ${canDraw && top.kind !== "skip" ? "" : "disabled"}` })
              : `<div class="pile empty">Empty</div>`
          }
        </div>
        <p class="status${myTurn ? " mine" : ""}" aria-live="polite">${status}</p>
      </section>
      <section class="table">${table}</section>
      <section class="me-area">
        <div class="me-head">
          <div><p class="lbl">Your Phase ${Math.min(me.phase, 10)}</p><p class="goal">${esc(describePhase(me.phase))}</p></div>
          <div class="sort" role="group" aria-label="Sort hand">
            <button type="button" class="chip${ui.sort === "number" ? " on" : ""}" data-sort="number">1–12</button>
            <button type="button" class="chip${ui.sort === "color" ? " on" : ""}" data-sort="color">Color</button>
          </div>
        </div>
        <div class="hand">${sortedHand(me.hand || [])
          .map((c) => cardHtml(c, { selected: sel.includes(c.id), attrs: `data-card="${c.id}"` }))
          .join("")}</div>
        <div class="actions">${actions}</div>
      </section>
      <details class="log"><summary>Game log</summary><ul>${v.log
        .slice(-12)
        .reverse()
        .map((l) => `<li>${esc(l)}</li>`)
        .join("")}</ul></details>
      ${v.status === "between" || v.status === "finished" ? resultsHtml(v) : ""}`;
  }

  function groupHtml(g, gi, canHit) {
    const label = g.kind === "set" ? `Set of ${g.n}s` : g.kind === "run" ? `Run ${g.start}–${g.end}` : `All ${g.c}`;
    return `<button type="button" class="group${canHit ? " target" : ""}" data-group="${gi}" ${canHit ? "" : "disabled"}
      aria-label="${esc(label)}${canHit ? ", add selected card" : ""}">
      <span class="g-label">${esc(label)}</span>
      <span class="g-cards">${g.cards.map((c) => cardHtml(c, { small: true, attrs: 'aria-hidden="true"' })).join("")}</span></button>`;
  }

  function resultsHtml(v) {
    const last = v.lastHand;
    const byId = Object.fromEntries(v.players.map((p) => [p.id, p]));
    const finished = v.status === "finished";
    const standings = v.players.slice().sort((a, b) => b.phase - a.phase || a.score - b.score);
    const title = finished
      ? `${v.winners.map((id) => esc(byId[id]?.name)).join(" & ")} ${v.winners.length > 1 ? "win" : "wins"}!`
      : `${esc(byId[last.wentOut]?.name)} went out`;
    return `<div class="overlay" role="dialog" aria-modal="true" aria-label="Hand results"><div class="sheet">
        <p class="lbl">${finished ? "Game over" : `End of hand ${last.handNo}`}</p>
        <h2>${title}</h2>
        <table><thead><tr><th>Player</th><th>This hand</th><th>Phase</th><th>Total</th></tr></thead><tbody>
        ${standings
          .map((p) => {
            const r = last.results.find((x) => x.id === p.id) || {};
            return `<tr${v.winners.includes(p.id) ? ' class="win"' : ""}><td>${esc(p.name)}</td>
              <td>${r.completed ? `Phase ${r.completed} ✓` : "Missed"} · +${r.points ?? 0}</td>
              <td>${p.phase > 10 ? "Done" : p.phase}</td><td>${p.score}</td></tr>`;
          })
          .join("")}</tbody></table>
        ${
          finished
            ? `<button type="button" class="btn primary" data-do="leave">Back to start</button>`
            : `<button type="button" class="btn primary" data-do="next">Deal hand ${v.handNo + 1}</button>`
        }
      </div></div>`;
  }

  function render() {
    const s = ui.snap;
    let body;
    if (s.screen === "loading") body = `<p class="muted center-msg">${esc(s.message || "Loading…")}</p>`;
    else if (s.screen === "unavailable") body = `<section class="panel"><h1 class="small-h">Phase Ten</h1><p>${esc(s.message)}</p></section>`;
    else if (s.screen === "home") body = homeHtml();
    else if (s.view.status === "lobby") body = lobbyHtml(s.view);
    else body = gameHtml(s.view);
    const focusId = document.activeElement && document.activeElement.id;
    const focusVal = focusId && document.getElementById(focusId)?.value;
    root.innerHTML = `<main class="wrap${ui.busy ? " busy" : ""}">${body}</main>${
      ui.toast ? `<div class="toast" role="alert">${esc(ui.toast)}</div>` : ""
    }`;
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        if (focusVal !== undefined) el.value = focusVal;
        el.focus();
      }
    }
  }

  // ---------- events ----------

  const nameValue = () => (document.getElementById("name")?.value || "").trim();

  root.addEventListener("click", (e) => {
    const t = e.target.closest("button, [data-card]");
    if (!t || t.disabled) return;
    const d = t.dataset;
    const v = ui.snap.view;

    if (d.card !== undefined) {
      const id = Number(d.card);
      ui.selected = ui.selected.includes(id) ? ui.selected.filter((x) => x !== id) : [...ui.selected, id];
      ui.skipPick = false;
      return render();
    }
    if (d.sort) {
      ui.sort = d.sort;
      try {
        localStorage.setItem("p10-sort", d.sort);
      } catch {}
      return render();
    }
    if (d.draw) return act({ type: "draw", source: d.draw });
    if (d.group !== undefined) return act({ type: "hit", cardId: ui.selected[0], groupIndex: Number(d.group) });
    if (d.skip) return act({ type: "discard", cardId: ui.selected[0], skipTarget: d.skip });
    if (d.kick) return act({ type: "leave", playerId: d.kick });
    if (d.join) {
      const name = nameValue();
      if (!name && d.mine === undefined) return setToast("Enter your name first.");
      return run(() => transport.joinGame(d.join, name));
    }
    switch (d.do) {
      case "create": {
        const name = nameValue();
        if (!name) return setToast("Enter your name first.");
        return run(() => transport.createGame(name));
      }
      case "start":
        return act({ type: "start" });
      case "next":
        return act({ type: "nextHand" });
      case "lay":
        return act({ type: "layDown", cardIds: ui.selected.slice() });
      case "discard": {
        const me = v.players.find((p) => p.id === v.me);
        const card = me.hand.find((c) => c.id === ui.selected[0]);
        if (card && card.kind === "skip" && v.players.length > 2) {
          ui.skipPick = true;
          return render();
        }
        return act({ type: "discard", cardId: ui.selected[0] });
      }
      case "cancel-skip":
        ui.skipPick = false;
        return render();
      case "copy": {
        const url = transport.shareUrl(ui.snap.code);
        const done = () => setToast("Invite link copied.");
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => setToast(url));
        else setToast(url);
        return;
      }
      case "leave":
        ui.selected = [];
        return run(() => transport.leave());
    }
  });

  // Keep typed text across re-renders triggered by live updates.
  root.addEventListener("input", (e) => {
    if (e.target.id === "name") ui.name = e.target.value;
    if (e.target.id === "join-code") ui.code = e.target.value;
  });

  root.addEventListener("submit", (e) => {
    if (e.target.id !== "join-form") return;
    e.preventDefault();
    const code = (document.getElementById("join-code")?.value || "").trim().toUpperCase();
    const name = nameValue();
    if (!name) return setToast("Enter your name first.");
    if (!/^[A-Z]{5}$/.test(code)) return setToast("Room codes are 5 letters.");
    run(() => transport.joinGame(code, name));
  });

  render();
}
