// Phase Ten table UI. Renders whatever the transport reports and sends player
// actions back through it, so the same screen runs on the website (server
// transport) and in the Claude artifact (shared-store transport).
import { PHASES, describePhase, MAX_PLAYERS } from "./engine.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const COLOR_ORDER = { red: 0, blue: 1, green: 2, yellow: 3 };
const SEAT_COLORS = ["#ff4d5e", "#3d8bff", "#19c37d", "#ffc21a", "#b77bff", "#ff8a3d"];
// Short phase names for the narrow player cards on phones.
const SHORT_PHASE = ["2 sets of 3", "Set 3 + run 4", "Set 4 + run 4", "Run of 7", "Run of 8", "Run of 9", "2 sets of 4", "7 of a color", "Set 5 + set 2", "Set 5 + set 3"];
const phaseSize = (phase) => (PHASES[phase - 1] || []).reduce((t, g) => t + g.size, 0);
const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const BOT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="2.5" r="1.6" fill="currentColor"/><rect x="4" y="6.5" width="16" height="12.5" rx="4" fill="currentColor"/><circle cx="9" cy="12.5" r="2" fill="var(--seat)"/><circle cx="15" cy="12.5" r="2" fill="var(--seat)"/><path d="M1.5 11v4M22.5 11v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const SKIP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M6 18 18 6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;

function cardHtml(card, { selected = false, attrs = "", small = false, cls = "", style = "" } = {}) {
  const kind = card.kind === "n" ? `c-${card.c}` : card.kind;
  const face = card.kind === "wild" ? "W" : card.kind === "skip" ? SKIP_ICON : card.n;
  const label = card.kind === "n" ? `${card.c} ${card.n}` : card.kind === "wild" ? "Wild" : "Skip";
  const corner = card.kind === "wild" ? "W" : card.kind === "skip" ? "S" : card.n;
  // Small cards sit inside a group button, so they render as spans.
  if (small) return `<span class="card small ${kind}${card.n >= 10 ? " two" : ""}" aria-hidden="true"><span class="pip">${face}</span></span>`;
  return `<button type="button" class="card ${kind}${selected ? " sel" : ""} ${cls}" ${style ? `style="${style}"` : ""} ${attrs}
    aria-label="${esc(label)}" aria-pressed="${selected}">
    <span class="corner">${corner}</span><span class="pip">${face}</span>
    <span class="tagline">${card.kind === "n" ? "" : esc(label)}</span></button>`;
}

function trackHtml(p) {
  let dots = "";
  for (let i = 1; i <= 10; i++) {
    const cls = i < p.phase ? "done" : i === p.phase ? (p.laid ? "done now" : "now") : "";
    dots += `<i class="${cls}"></i>`;
  }
  const label = p.phase > 10 ? "All 10 phases complete" : `On phase ${p.phase} of 10`;
  return `<span class="track" role="img" aria-label="${label}">${dots}</span>`;
}

function avatarHtml(name, color, extra = "", bot = false) {
  return `<span class="avatar${bot ? " bot" : ""}" style="--seat:${color}">${bot ? BOT_ICON : esc(initials(name))}${extra}</span>`;
}

// Short-lived celebration effects drawn above the page.
function createFx(layer) {
  const canvas = layer.querySelector("canvas");
  const callout = layer.querySelector(".callout");
  let parts = [];
  let raf = 0;

  function confetti(amount = 140) {
    if (reduceMotion()) return;
    const w = (canvas.width = innerWidth * devicePixelRatio);
    const h = (canvas.height = innerHeight * devicePixelRatio);
    const colors = SEAT_COLORS.slice(0, 4).concat("#ffffff");
    for (let i = 0; i < amount; i++) {
      parts.push({
        x: w * (0.2 + Math.random() * 0.6),
        y: h * 0.35,
        vx: (Math.random() - 0.5) * 22 * devicePixelRatio,
        vy: (-8 - Math.random() * 16) * devicePixelRatio,
        s: (5 + Math.random() * 7) * devicePixelRatio,
        r: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.4,
        c: colors[i % colors.length],
        life: 0,
      });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick() {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts = parts.filter((p) => p.life < 160 && p.y < canvas.height + 40);
    for (const p of parts) {
      p.life++;
      p.vy += 0.55 * devicePixelRatio;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66);
      ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(tick) : 0;
  }

  function shout(text, tone = "") {
    callout.textContent = text;
    callout.className = `callout ${tone}`;
    void callout.offsetWidth; // restart the animation
    callout.classList.add("go");
  }

  return { confetti, shout };
}

export function mountApp(root, transport) {
  const ui = { snap: { screen: "loading" }, selected: [], sort: "number", busy: false, skipPick: false, fresh: null, seen: new Set(), order: [], orderKey: null };
  let drag = null; // the card being dragged; declared here because the first render can run during init
  try {
    ui.sort = localStorage.getItem("p10-sort") || "number";
  } catch {}

  root.innerHTML = `<main class="wrap"></main>
    <div class="toast-layer" aria-live="assertive"></div>
    <div class="fx" aria-hidden="true"><canvas></canvas><div class="callout"></div></div>`;
  const main = root.querySelector("main");
  const toastLayer = root.querySelector(".toast-layer");
  const fx = createFx(root.querySelector(".fx"));

  function setToast(msg) {
    toastLayer.innerHTML = msg ? `<div class="toast" role="alert">${esc(msg)}</div>` : "";
    clearTimeout(setToast.t);
    if (msg) setToast.t = setTimeout(() => setToast(""), 4000);
  }

  // Your own card order is kept per hand on this device (card ids are reused
  // when the deck is reshuffled for the next hand).
  const orderKey = () => `p10-order-${ui.snap.code}-${ui.snap.view && ui.snap.view.handNo}`;
  function loadOrder() {
    if (ui.orderKey === orderKey()) return;
    ui.orderKey = orderKey();
    try {
      ui.order = JSON.parse(localStorage.getItem(ui.orderKey)) || [];
    } catch {
      ui.order = [];
    }
  }
  function saveOrder(ids) {
    ui.order = ids;
    ui.orderKey = orderKey();
    try {
      localStorage.setItem(ui.orderKey, JSON.stringify(ids));
    } catch {}
  }
  function setSort(sort) {
    ui.sort = sort;
    try {
      localStorage.setItem("p10-sort", sort);
    } catch {}
  }

  async function run(fn) {
    if (ui.busy) return;
    ui.busy = true;
    main.classList.add("busy");
    try {
      await fn();
    } catch (e) {
      setToast(e && e.message ? e.message : "Something went wrong. Try again.");
    } finally {
      ui.busy = false;
      main.classList.remove("busy");
      // A full redraw here would cut short the animations the update just started.
      if (ui.snap.screen === "game" && ui.snap.view.status !== "lobby") refreshSelection();
      else render();
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

  // Works out what changed since the last update so only new things animate.
  function diff(prev, v) {
    if (!v || v.status === "lobby") return null;
    const sameGame = prev && prev.me === v.me && prev.host === v.host && prev.status !== "lobby";
    const me = v.players.find((p) => p.id === v.me);
    const myTurn = v.status === "playing" && v.players[v.turn].id === v.me;
    if (!sameGame) return { deal: true, cards: new Set(), myTurn };
    const pme = prev.players.find((p) => p.id === prev.me);
    const f = { deal: v.handNo !== prev.handNo, cards: new Set(), events: [] };
    if (!f.deal && me.hand && pme && pme.hand) {
      for (const c of me.hand) if (!pme.hand.some((x) => x.id === c.id)) f.cards.add(c.id);
    }
    const top = v.discard[0];
    const ptop = prev.discard[0];
    f.discard = !!top && (!ptop || ptop.id !== top.id);
    if (!f.deal) {
      for (const p of v.players) {
        const pp = prev.players.find((x) => x.id === p.id);
        if (p.laid && pp && !pp.laid) f.events.push(p.id === v.me ? `Phase ${p.phase} done!` : `${p.name} made Phase ${p.phase}`);
      }
    }
    const ld = v.lastDraw;
    if (ld && JSON.stringify(ld) !== JSON.stringify(prev.lastDraw)) {
      f.draw = ld;
      if (ld.player !== v.me) f.drew = ld.source;
    }
    f.win = v.status === "finished" && prev.status !== "finished";
    f.handEnd = v.status === "between" && prev.status === "playing";
    f.myTurn = myTurn && !(prev.status === "playing" && prev.players[prev.turn].id === prev.me);
    const skippedMe = me.skipped && !(pme && pme.skipped);
    if (skippedMe) f.events.push("You got skipped!");
    return f;
  }

  transport.init((snap) => {
    const prev = ui.snap.view;
    const same =
      snap.view && prev && ui.snap.code === snap.code && prev.seq === snap.view.seq && prev.me === snap.view.me && !ui.snap.offline === !snap.offline;
    ui.snap = snap;
    if (same) return; // the same update echoed back; redrawing would restart animations
    // Drop selections for cards that left the hand.
    const me = snap.view && snap.view.players.find((p) => p.id === snap.view.me);
    if (me && me.hand) ui.selected = ui.selected.filter((id) => me.hand.some((c) => c.id === id));
    ui.fresh = diff(prev, snap.view);
    render();
    celebrate(ui.fresh);
    flyDraw(ui.fresh, snap.view);
    ui.fresh = null;
  });

  // A card flies from the pile that was drawn from: into its slot in your hand
  // (face down from the deck, then flipping over), or to another player's seat.
  function flyDraw(f, v) {
    if (!f || !f.draw || !v || reduceMotion()) return;
    const { player, source, card } = f.draw;
    const pile = main.querySelector(source === "deck" ? ".deck" : ".discard-pile");
    const mine = player === v.me;
    const target = mine
      ? [...main.querySelectorAll(".hand .card.incoming")].pop()
      : main.querySelector(`.seat[data-seat="${CSS.escape(player)}"] .avatar`);
    if (!pile || !target) return;
    const from = pile.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const layer = root.querySelector(".fx");
    const wrap = document.createElement("div");
    wrap.className = "fly";
    wrap.style.cssText = `left:${from.left}px;top:${from.top}px;--w:${from.width}px`;
    wrap.innerHTML =
      source === "discard" && card
        ? cardHtml(card, { attrs: 'tabindex="-1" aria-hidden="true"' })
        : `<div class="fly-back"><span class="deck-mark">10</span></div>`;
    layer.append(wrap);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const scale = mine ? to.width / from.width : 0.35;
    const flight = wrap.animate(
      [
        { transform: "translate(0, 0) rotate(0deg) scale(1)", opacity: 1 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 50}px) rotate(-10deg) scale(1.12)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${mine ? 0 : 20}deg) scale(${scale})`, opacity: mine ? 1 : 0 },
      ],
      { duration: mine ? 560 : 650, easing: "cubic-bezier(0.25, 0.8, 0.3, 1)" }
    );
    const land = () => {
      wrap.remove();
      if (mine) {
        // The real card may have been redrawn meanwhile; find it again.
        const el = main.querySelector(`.hand .card[data-card="${target.dataset.card}"]`);
        if (el) {
          el.classList.remove("incoming");
          el.classList.add(source === "deck" ? "flip-in" : "settle");
        }
      } else {
        const seat = main.querySelector(`.seat[data-seat="${CSS.escape(player)}"]`);
        if (seat) {
          seat.classList.remove("got-card");
          void seat.offsetWidth;
          seat.classList.add("got-card");
        }
      }
    };
    flight.onfinish = land;
    flight.oncancel = land;
  }

  function celebrate(f) {
    if (!f) return;
    if (f.win) {
      fx.confetti(260);
      return fx.shout("Winner!", "gold");
    }
    if (f.handEnd) fx.confetti(120);
    if (f.events && f.events.length) {
      fx.confetti(90);
      fx.shout(f.events[f.events.length - 1], f.events.at(-1).startsWith("You got") ? "warn" : "");
    } else if (f.myTurn) {
      fx.shout("Your turn");
      try {
        navigator.vibrate && navigator.vibrate(25);
      } catch {}
    }
  }

  // ---------- screens ----------

  function heroCards() {
    const cards = [
      { kind: "n", n: 7, c: "red" },
      { kind: "n", n: 8, c: "blue" },
      { kind: "n", n: 9, c: "green" },
      { kind: "wild" },
      { kind: "n", n: 11, c: "yellow" },
    ];
    return `<div class="hero-fan" aria-hidden="true">${cards
      .map((c, i) => cardHtml(c, { attrs: "tabindex='-1' disabled", style: `--i:${i - 2}` }))
      .join("")}</div>`;
  }

  function homeHtml() {
    const s = ui.snap;
    const nameVal = esc(ui.name ?? s.defaultName ?? "");
    const games = s.games || [];
    const joinBlock = transport.listsGames
      ? `<section class="panel">
          <h2>Open tables</h2>
          ${
            games.length
              ? `<ul class="games">${games
                  .map(
                    (g, i) => `<li>${avatarHtml(g.hostName, SEAT_COLORS[i % SEAT_COLORS.length])}
                      <div class="grow"><strong>${esc(g.hostName)}'s table</strong>
                      <span class="muted small">${g.players}/${MAX_PLAYERS} seated · ${esc(g.code)}</span></div>
                      <button type="button" class="btn ${g.mine ? "go" : ""}" data-join="${esc(g.code)}"${g.mine ? " data-mine" : ""}>${g.mine ? "Rejoin" : "Join"}</button></li>`
                  )
                  .join("")}</ul>`
              : `<p class="muted">No open tables yet. Start one and tell your friends to open this page.</p>`
          }
        </section>`
      : `<section class="panel">
          <h2>Got a code?</h2>
          <form id="join-form" class="row">
            <label class="grow"><span class="lbl">Room code</span>
              <input id="join-code" class="code-input" autocomplete="off" maxlength="5" placeholder="ABCDE" value="${esc(ui.code ?? s.prefillCode ?? "")}"></label>
            <button class="btn go" type="submit">Join</button>
          </form>
        </section>`;
    return `<header class="hero">
        ${heroCards()}
        <h1 class="logo"><span class="logo-phase">Phase</span><span class="logo-ten">Ten</span></h1>
        <p class="tagline-main">Ten phases. Up to ${MAX_PLAYERS} friends. Lowest score at the finish wins.</p>
      </header>
      <section class="panel">
        <label><span class="lbl">Your name</span>
          <input id="name" maxlength="20" autocomplete="nickname" value="${nameVal}" placeholder="What do your friends call you?"></label>
        <button type="button" class="btn primary big" data-do="create">Start a table</button>
        <button type="button" class="btn big bots" data-do="solo">${BOT_ICON}Practice against 2 bots</button>
      </section>
      ${joinBlock}
      ${webLinkHtml()}
      <details class="panel rules"><summary>How to play</summary>${rulesHtml()}</details>`;
  }

  // The artifact points people at the website, which needs no Claude account.
  // A declaration, not a const: the website transport renders during init,
  // before a const further down this function would exist.
  function webLinkHtml() {
    return transport.webUrl
      ? `<a class="btn big web-link" href="${esc(transport.webUrl)}" target="_blank" rel="noopener">Play on the web · no account needed</a>`
      : "";
  }

  function rulesHtml() {
    return `<ol class="phase-list">${PHASES.map((_, i) => `<li><b>${i + 1}</b><span>${esc(describePhase(i + 1))}</span></li>`).join("")}</ol>
      <p>Draw from the deck or the discard pile. If you can, lay down your whole phase at once.
      After that, add cards to any group on the table. End your turn by discarding.
      A Wild stands in for any card. A Skip makes someone miss their next turn.</p>
      <p>The hand ends when someone runs out of cards. Everyone who laid down their phase moves up.
      Cards left in hand score: 1–9 are 5 points, 10–12 are 10, Skip 15, Wild 25.</p>`;
  }

  function lobbyHtml(v) {
    const isHost = v.host === v.me;
    const code = String(ui.snap.code || "");
    return `<section class="lobby-top">
        <p class="lbl">Room code</p>
        <p class="code-tiles" aria-label="Room code ${esc(code.split("").join(" "))}">${code
          .split("")
          .map((ch, i) => `<span style="--i:${i}">${esc(ch)}</span>`)
          .join("")}</p>
        ${transport.shareHint ? `<p class="muted">${esc(transport.shareHint(code))}</p>` : ""}
        ${transport.shareUrl ? `<button type="button" class="btn" data-do="copy">Copy invite link</button>` : ""}
      </section>
      <section class="panel">
        <h2>At the table <span class="count">${v.players.length}/${MAX_PLAYERS}</span></h2>
        <ul class="seat-grid">${v.players
          .map(
            (p, i) => `<li class="${ui.seen.has(p.id) ? "" : "pop"}" style="--i:${i}">${avatarHtml(p.name, SEAT_COLORS[i % SEAT_COLORS.length], "", p.bot)}
              <span class="seat-label">${esc(p.name)}</span>
              <span class="seat-sub">${p.bot ? "Bot" : ""}${p.id === v.host ? "Host" : ""}${p.id === v.me ? (p.id === v.host ? " · you" : "You") : ""}</span>
              ${isHost && p.id !== v.me ? `<button type="button" class="link small" data-kick="${esc(p.id)}">Remove</button>` : ""}</li>`
          )
          .join("")}${Array.from({ length: MAX_PLAYERS - v.players.length }, (_, k) =>
          isHost && k === 0
            ? `<li class="empty-seat"><button type="button" class="add-bot" data-do="add-bot"><span class="avatar ghost">+</span><span class="seat-label">Add a bot</span></button></li>`
            : `<li class="empty-seat"><span class="avatar ghost"></span></li>`
        ).join("")}</ul>
        ${
          isHost
            ? `<button type="button" class="btn primary big" data-do="start" ${v.players.length < 2 ? "disabled" : ""}>
                ${v.players.length < 2 ? "Waiting for a friend…" : `Deal ${v.players.length} players in`}</button>`
            : `<p class="waiting"><span class="dots"><i></i><i></i><i></i></span>Waiting for ${esc(v.players.find((p) => p.id === v.host)?.name || "the host")} to deal</p>`
        }
        <button type="button" class="link" data-do="leave">Leave table</button>
      </section>`;
  }

  function sortedHand(hand) {
    const h = hand.slice();
    const rank = (c) => (c.kind === "wild" ? 100 : c.kind === "skip" ? 200 : 0);
    if (ui.sort === "custom") {
      // Cards you've placed keep their spot; new ones join on the right.
      loadOrder();
      const pos = new Map(ui.order.map((id, i) => [id, i]));
      const at = (c) => (pos.has(c.id) ? pos.get(c.id) : 1000 + hand.indexOf(c));
      return h.sort((a, b) => at(a) - at(b));
    }
    if (ui.sort === "color") {
      h.sort((a, b) => rank(a) - rank(b) || COLOR_ORDER[a.c] - COLOR_ORDER[b.c] || a.n - b.n);
    } else {
      h.sort((a, b) => rank(a) - rank(b) || a.n - b.n || COLOR_ORDER[a.c] - COLOR_ORDER[b.c]);
    }
    return h;
  }

  function derive(v) {
    const me = v.players.find((p) => p.id === v.me);
    const myTurn = v.status === "playing" && v.players[v.turn].id === v.me;
    const sel = ui.selected;
    const play = myTurn && v.step === "play";
    return {
      me,
      myTurn,
      need: phaseSize(me.phase),
      selCards: sel.map((id) => me.hand.find((c) => c.id === id)).filter(Boolean),
      canDraw: myTurn && v.step === "draw",
      canLay: play && !me.laid && sel.length === phaseSize(me.phase),
      canDiscard: play && sel.length === 1,
      canHit: play && me.laid && sel.length === 1,
    };
  }

  function actionsHtml(v, d) {
    if (!d.myTurn) {
      return `<p class="hint">${v.status === "playing" ? "Tap cards to plan your phase while you wait." : ""}</p>`;
    }
    if (v.step === "draw") return `<p class="hint strong">Draw a card: tap the deck or the discard pile.</p>`;
    const skipSel = d.selCards.length === 1 && d.selCards[0].kind === "skip";
    if (ui.skipPick && skipSel && v.players.length > 2) {
      return `<div class="pick"><span class="hint strong">Skip who?</span>${v.players
        .map((p, i) =>
          p.id === v.me || p.skipped
            ? ""
            : `<button type="button" class="btn chip-btn" data-skip="${esc(p.id)}">${avatarHtml(p.name, SEAT_COLORS[i % SEAT_COLORS.length], "", p.bot)}${esc(p.name)}</button>`
        )
        .join("")}<button type="button" class="link" data-do="cancel-skip">Cancel</button></div>`;
    }
    const sel = ui.selected.length;
    return `${
      !d.me.laid
        ? `<button type="button" class="btn go" data-do="lay" ${d.canLay ? "" : "disabled"}>
            Lay down <span class="badge">${sel}/${d.need}</span></button>`
        : ""
    }
      <button type="button" class="btn danger" data-do="discard" ${d.canDiscard ? "" : "disabled"}>${skipSel ? "Play Skip" : "Discard"}</button>
      ${d.canHit ? `<span class="hint">or tap a glowing group to add it</span>` : d.me.laid ? `<span class="hint">Pick a card to add to the table or discard</span>` : ""}`;
  }

  function seatPhaseHtml(p) {
    if (p.phase > 10) return `<div class="seat-phase done"><b>All 10 done</b></div>`;
    const full = describePhase(p.phase);
    return `<div class="seat-phase${p.laid ? " done" : ""}" title="Phase ${p.phase}: ${esc(full)}${p.laid ? " (laid down)" : ""}">
      <b>P${p.phase}</b><span class="full">${esc(full)}</span><span class="short">${esc(SHORT_PHASE[p.phase - 1])}</span>${p.laid ? '<i aria-label="laid down">✓</i>' : ""}</div>`;
  }

  // Says where the latest draw came from, so everyone can follow the piles.
  function drawNoteHtml(v, f) {
    const ld = v.lastDraw;
    const p = ld && v.players.find((x) => x.id === ld.player);
    if (!p || v.status !== "playing") return "";
    const who = p.id === v.me ? "You" : esc(p.name);
    const pop = f.drew ? " pop" : "";
    return ld.source === "discard"
      ? `<p class="draw-note from-discard${pop}"><span class="src">Discard</span><span>${who} took ${cardHtml(ld.card, { small: true })}</span></p>`
      : `<p class="draw-note from-deck${pop}"><span class="src">Deck</span><span>${who} drew from the deck</span></p>`;
  }

  function statusText(v, d) {
    const turnP = v.players[v.turn];
    if (v.status !== "playing") return "Hand over";
    if (!d.myTurn) return turnP.bot ? `${esc(turnP.name)} is calculating…` : `${esc(turnP.name)} is thinking…`;
    return v.step === "draw" ? "Your turn · draw" : "Your turn · discard";
  }

  function gameHtml(v) {
    const d = derive(v);
    const f = ui.fresh || { cards: new Set() };
    const top = v.discard[0];

    const seats = v.players
      .map((p, i) => {
        const active = v.status === "playing" && i === v.turn;
        const badges =
          (i === v.dealer ? `<b class="dealer" title="Dealer">D</b>` : "") +
          (p.skipped ? `<b class="skipmark" title="Skipped next turn">${SKIP_ICON}</b>` : "");
        return `<li class="seat${active ? " active" : ""}${p.id === v.me ? " me" : ""}${p.skipped ? " skipped" : ""}" data-seat="${esc(p.id)}">
          ${avatarHtml(p.name, SEAT_COLORS[i % SEAT_COLORS.length], badges, p.bot)}
          <div class="seat-info">
            <div class="seat-name">${esc(p.name)}${p.id === v.me ? ' <span class="you">you</span>' : ""}</div>
            <div class="seat-stats"><span class="mini-hand" title="Cards in hand">${p.handCount}</span><span>${p.score} pts</span>${p.laid ? '<span class="done-chip">Phase down</span>' : ""}</div>
            ${seatPhaseHtml(p)}
            ${trackHtml(p)}
          </div></li>`;
      })
      .join("");

    const owners = v.players.map((p, i) => ({ p, i })).filter(({ p }) => v.table.some((g) => g.owner === p.id));
    const table = owners.length
      ? owners
          .map(
            ({ p, i }) => `<div class="owner" style="--seat:${SEAT_COLORS[i % SEAT_COLORS.length]}">
              <p class="owner-name"><i></i>${esc(p.name)} · Phase ${p.phase}</p>
              <div class="groups">${v.table.map((g, gi) => (g.owner !== p.id ? "" : groupHtml(g, gi, d.canHit))).join("")}</div></div>`
          )
          .join("")
      : `<p class="table-empty">Completed phases land here.</p>`;

    const hand = sortedHand(d.me.hand || []);
    const n = hand.length;
    const mid = (n - 1) / 2;
    const tilt = Math.min(2.5, 20 / Math.max(n, 1));
    const handHtml = hand
      .map((c, i) => {
        const off = i - mid;
        const flying = f.draw && f.draw.player === v.me && !reduceMotion();
        const cls = f.deal ? "deal" : f.cards.has(c.id) ? (flying ? "incoming" : "fresh") : "";
        const style = `--i:${i};--r:${(off * tilt).toFixed(2)}deg;--y:${(off * off * 0.7).toFixed(1)}px`;
        return cardHtml(c, { selected: ui.selected.includes(c.id), attrs: `data-card="${c.id}"`, cls, style });
      })
      .join("");

    return `<div class="topbar">
        <span class="room">Room <b>${esc(ui.snap.code)}</b> · Hand ${v.handNo}${ui.snap.offline ? ' <span class="offline">Reconnecting…</span>' : ""}</span>
        <button type="button" class="link" data-do="leave">Leave</button>
      </div>
      <div class="side">
      <ul class="seats">${seats}</ul>
      <section class="mat">
        <div class="piles">
          <button type="button" class="deck${f.drew === "deck" ? " pulled" : ""}" data-draw="deck" ${d.canDraw ? "" : "disabled"} aria-label="Draw from deck, ${v.deckCount} cards left">
            <span class="deck-mark">10</span><span class="deck-count">${v.deckCount}</span></button>
          <div class="discard-pile${v.discardCount > 1 ? " stacked" : ""}${f.drew === "discard" ? " pulled" : ""}">
            ${
              top
                ? cardHtml(top, { cls: f.discard ? "land" : "", attrs: `data-draw="discard" ${d.canDraw && top.kind !== "skip" ? "" : "disabled"}` })
                : `<div class="empty-slot">Discard</div>`
            }
          </div>
        </div>
        <div class="mat-info">
          <p class="turn-pill${d.myTurn ? " mine" : ""}" aria-live="polite">${statusText(v, d)}</p>
          ${drawNoteHtml(v, f)}
        </div>
      </section>
      </div>
      <section class="table" aria-label="Phases on the table">${table}
        <details class="log"><summary>Game log</summary><ul>${v.log
          .slice(-12)
          .reverse()
          .map((l) => `<li>${esc(l)}</li>`)
          .join("")}</ul></details>
      </section>
      <section class="dock${d.myTurn ? " mine" : ""}">
        <div class="dock-head">
          <span class="phase-badge" aria-hidden="true">${Math.min(d.me.phase, 10)}</span>
          <div class="grow"><p class="lbl">Your phase</p><p class="goal">${esc(describePhase(d.me.phase))}</p></div>
          <div class="sort" role="group" aria-label="Sort hand">
            <button type="button" class="chip${ui.sort === "number" ? " on" : ""}" data-sort="number">1–12</button>
            <button type="button" class="chip${ui.sort === "color" ? " on" : ""}" data-sort="color">Color</button>
            <button type="button" class="chip${ui.sort === "custom" ? " on" : ""}" data-sort="custom" title="Your own order: drag cards to rearrange">Mine</button>
          </div>
        </div>
        <div class="actions">${actionsHtml(v, d)}</div>
        <div class="hand" style="--n:${n}" title="Drag cards to rearrange">${handHtml}</div>
      </section>
      ${v.status === "between" || v.status === "finished" ? resultsHtml(v) : ""}`;
  }

  function groupHtml(g, gi, canHit) {
    const label = g.kind === "set" ? `Set of ${g.n}s` : g.kind === "run" ? `Run ${g.start}–${g.end}` : `All ${g.c}`;
    return `<button type="button" class="group${canHit ? " target" : ""}" data-group="${gi}" ${canHit ? "" : "disabled"}
      aria-label="${esc(label)}${canHit ? ", add selected card" : ""}">
      <span class="g-label">${esc(label)}</span>
      <span class="g-cards">${g.cards.map((c) => cardHtml(c, { small: true })).join("")}</span>
      <span class="g-plus" aria-hidden="true">+</span></button>`;
  }

  function resultsHtml(v) {
    const last = v.lastHand;
    const seatOf = (id) => v.players.findIndex((p) => p.id === id);
    const byId = Object.fromEntries(v.players.map((p) => [p.id, p]));
    const finished = v.status === "finished";
    const standings = v.players.slice().sort((a, b) => b.phase - a.phase || a.score - b.score);
    const title = finished
      ? `${v.winners.map((id) => esc(byId[id]?.name)).join(" & ")} ${v.winners.length > 1 ? "win" : "wins"}!`
      : `${esc(byId[last.wentOut]?.name)} went out`;
    return `<div class="overlay" role="dialog" aria-modal="true" aria-label="Hand results"><div class="sheet">
        <p class="lbl">${finished ? "Game over" : `End of hand ${last.handNo}`}</p>
        <h2 class="sheet-title">${finished ? "🏆 " : ""}${title}</h2>
        <ul class="results">${standings
          .map((p) => {
            const r = last.results.find((x) => x.id === p.id) || {};
            const i = seatOf(p.id);
            return `<li class="${v.winners.includes(p.id) ? "win" : ""}">
              ${avatarHtml(p.name, SEAT_COLORS[i % SEAT_COLORS.length], "", p.bot)}
              <div class="grow"><strong>${esc(p.name)}</strong>
                <span class="r-sub ${r.completed ? "ok" : "miss"}">${r.completed ? `Made phase ${r.completed}` : "Missed the phase"} · +${r.points ?? 0}</span>
                ${trackHtml({ ...p, laid: false })}</div>
              <span class="r-total">${p.score}<small>pts</small></span></li>`;
          })
          .join("")}</ul>
        ${
          finished
            ? `<button type="button" class="btn primary big" data-do="leave">Back to the lobby</button>`
            : `<button type="button" class="btn primary big" data-do="next">Deal hand ${v.handNo + 1}</button>`
        }
      </div></div>`;
  }

  function render() {
    // Redrawing mid-drag would drop the card out of the player's finger.
    if (drag && drag.moved) {
      drag.renderLater = true;
      return;
    }
    const s = ui.snap;
    let body;
    if (s.screen === "loading") body = `<div class="center-msg"><span class="dots"><i></i><i></i><i></i></span><p>${esc(s.message || "Loading…")}</p></div>`;
    else if (s.screen === "unavailable") body = `<section class="panel"><h1 class="logo small-logo"><span class="logo-ten">Phase Ten</span></h1><p>${esc(s.message)}</p>${webLinkHtml()}</section>`;
    else if (s.screen === "home") body = homeHtml();
    else if (s.screen === "lost")
      body = `<section class="panel lost"><h2>Can't reach room ${esc(s.code)}</h2>
        <p class="muted">The game server didn't answer. Your game is saved, so you can try again, or start fresh.</p>
        <div class="row"><button type="button" class="btn primary grow" data-do="retry">Try again</button>
        <button type="button" class="btn grow" data-do="leave">Back to start</button></div></section>`;
    else if (s.view.status === "lobby") body = lobbyHtml(s.view);
    else body = gameHtml(s.view);
    const focusId = document.activeElement && document.activeElement.id;
    main.className = `wrap screen-${s.screen === "game" ? (s.view.status === "lobby" ? "lobby" : "game") : s.screen}${ui.busy ? " busy" : ""}`;
    main.innerHTML = body;
    if (s.view) for (const p of s.view.players) ui.seen.add(p.id);
    if (focusId) document.getElementById(focusId)?.focus();
  }

  // Selecting cards only touches the hand, the action bar and the table targets,
  // so the lift animation plays and nothing else redraws.
  function refreshSelection() {
    const v = ui.snap.view;
    if (!v || v.status === "lobby") return render();
    const d = derive(v);
    main.querySelectorAll(".hand .card").forEach((el) => {
      const on = ui.selected.includes(Number(el.dataset.card));
      el.classList.toggle("sel", on);
      el.setAttribute("aria-pressed", on);
    });
    const actions = main.querySelector(".actions");
    if (actions) actions.innerHTML = actionsHtml(v, d);
    main.querySelectorAll(".group").forEach((el) => {
      el.classList.toggle("target", d.canHit);
      el.disabled = !d.canHit;
    });
  }

  // ---------- dragging cards to rearrange the hand ----------
  // A tap still selects a card; moving the finger or mouse past a few pixels
  // picks the card up instead, and dropping it saves your own order.

  main.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".hand .card");
    if (!el || e.button > 0) return;
    drag = { el, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
  });

  addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 8) return;
      drag.moved = true;
      const r = drag.el.getBoundingClientRect();
      drag.grab = drag.startX - (r.left + r.width / 2);
      drag.el.classList.add("dragging");
    }
    e.preventDefault();
    const handEl = drag.el.parentElement;
    const before = [...handEl.children].find((c) => {
      if (c === drag.el) return false;
      const r = c.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2;
    });
    if ((before || null) !== drag.el.nextElementSibling) handEl.insertBefore(drag.el, before || null);
    // Follow the pointer from wherever the card's slot now is.
    drag.el.style.translate = "";
    const home = drag.el.getBoundingClientRect();
    drag.el.style.translate = `${Math.round(e.clientX - drag.grab - (home.left + home.width / 2))}px ${Math.round(Math.min(0, e.clientY - drag.startY) - 26)}px`;
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const done = drag;
    drag = null;
    if (!done.moved) return;
    ui.justDragged = true;
    setTimeout(() => (ui.justDragged = false), 300);
    const ids = [...done.el.parentElement.children].map((c) => Number(c.dataset.card));
    saveOrder(ids);
    setSort("custom");
    render();
  }
  addEventListener("pointerup", endDrag);
  addEventListener("pointercancel", endDrag);

  // ---------- events ----------

  const nameValue = () => (document.getElementById("name")?.value || "").trim();

  root.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || t.disabled || !main.contains(t)) return;
    const d = t.dataset;
    const v = ui.snap.view;

    if (d.card !== undefined) {
      if (ui.justDragged) return;
      const id = Number(d.card);
      ui.selected = ui.selected.includes(id) ? ui.selected.filter((x) => x !== id) : [...ui.selected, id];
      ui.skipPick = false;
      return refreshSelection();
    }
    if (d.sort) {
      setSort(d.sort);
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
      case "add-bot":
        return act({ type: "addBot" });
      case "solo": {
        const name = nameValue();
        if (!name) return setToast("Enter your name first.");
        return run(async () => {
          await transport.createGame(name);
          await transport.act({ type: "addBot" });
          await transport.act({ type: "addBot" });
          await transport.act({ type: "start" });
        });
      }
      case "next":
        return act({ type: "nextHand" });
      case "lay":
        return act({ type: "layDown", cardIds: ui.selected.slice() });
      case "discard": {
        const me = v.players.find((p) => p.id === v.me);
        const card = me.hand.find((c) => c.id === ui.selected[0]);
        const canSkipSomeone = v.players.some((p) => p.id !== v.me && !p.skipped);
        if (card && card.kind === "skip" && v.players.length > 2 && canSkipSomeone) {
          ui.skipPick = true;
          return refreshSelection();
        }
        return act({ type: "discard", cardId: ui.selected[0] });
      }
      case "cancel-skip":
        ui.skipPick = false;
        return refreshSelection();
      case "copy": {
        const url = transport.shareUrl(ui.snap.code);
        const done = () => setToast("Invite link copied.");
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => setToast(url));
        else setToast(url);
        return;
      }
      case "retry":
        return transport.retry();
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
