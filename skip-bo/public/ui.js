// Skip-Bo table UI. Renders whatever the transport reports and sends player
// actions back through it, so the same screen runs on the website (server
// transport) and in the Claude artifact (shared-store transport).
import { MAX_PLAYERS, STOCK_CHOICES, officialStock, nextFor, fits } from "./engine.js";

const dirOf = (v) => (v && v.direction) || "up";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const SEAT_COLORS = ["#f2a65a", "#7fb2ff", "#6fd19a", "#ef7d84", "#c3a3ff", "#5fd0c6"];
const seatColor = (i) => SEAT_COLORS[i % SEAT_COLORS.length];
const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// The real game's colors: 1–4 blue, 5–8 green, 9–12 red.
const band = (n) => (n <= 4 ? "blue" : n <= 8 ? "green" : "red");

const BOT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="2.5" r="1.6" fill="currentColor"/><rect x="4" y="6.5" width="16" height="12.5" rx="4" fill="currentColor"/><circle cx="9" cy="12.5" r="2" fill="var(--seat)"/><circle cx="15" cy="12.5" r="2" fill="var(--seat)"/><path d="M1.5 11v4M22.5 11v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

// One card. `as` is the number a Skip-Bo card stands for on a building pile.
function cardHtml(card, { tag = "div", attrs = "", cls = "", as = null } = {}) {
  if (!card) return "";
  if (card.kind === "wild") {
    return `<${tag} class="card wild ${cls}" ${attrs} aria-label="Skip-Bo${as ? ` as ${as}` : ""}">
      <span class="sb"><b>Skip</b><b>Bo</b></span>${as ? `<span class="as">${as}</span>` : ""}</${tag}>`;
  }
  // 6 and 9 are underlined, as on printed cards, so upside-down corners read right.
  return `<${tag} class="card c-${band(card.n)}${card.n === 6 || card.n === 9 ? " u" : ""} ${cls}" ${attrs} aria-label="${card.n}">
    <span class="corner tl">${card.n}</span><span class="pip">${card.n}</span><span class="corner br">${card.n}</span></${tag}>`;
}

function avatarHtml(name, color, bot = false, extra = "") {
  return `<span class="avatar${bot ? " bot" : ""}" style="--seat:${color}">${bot ? BOT_ICON : esc(initials(name))}${extra}</span>`;
}

// Short-lived celebration effects drawn above the page.
function createFx(layer) {
  const canvas = layer.querySelector("canvas");
  const callout = layer.querySelector(".callout");
  let parts = [];
  let raf = 0;

  function confetti(amount = 140, at = null) {
    if (reduceMotion()) return;
    const dpr = devicePixelRatio;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    const colors = ["#f2711c", "#1f5cbd", "#17824a", "#c42d37", "#f6f2e9"];
    const x0 = at ? at.x * dpr : canvas.width * 0.5;
    const y0 = at ? at.y * dpr : canvas.height * 0.35;
    for (let i = 0; i < amount; i++) {
      parts.push({
        x: x0 + (at ? 0 : (Math.random() - 0.5) * canvas.width * 0.6),
        y: y0,
        vx: (Math.random() - 0.5) * (at ? 14 : 22) * dpr,
        vy: (-6 - Math.random() * (at ? 10 : 16)) * dpr,
        s: (5 + Math.random() * 6) * dpr,
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
    parts = parts.filter((p) => p.life < 150 && p.y < canvas.height + 40);
    for (const p of parts) {
      p.life++;
      p.vy += 0.5 * devicePixelRatio;
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
    void callout.offsetWidth;
    callout.classList.add("go");
  }

  return { confetti, shout };
}

export function mountApp(root, transport) {
  const ui = { snap: { screen: "loading" }, sel: null, busy: false, lastMove: null, seen: new Set() };
  let drag = null; // declared up here because the first render can run during init

  root.innerHTML = `<main class="wrap"></main>
    <div class="toast-layer" aria-live="assertive"></div>
    <div class="fx" aria-hidden="true"><canvas></canvas><div class="callout"></div></div>`;
  const main = root.querySelector("main");
  const toastLayer = root.querySelector(".toast-layer");
  const fxLayer = root.querySelector(".fx");
  const fx = createFx(fxLayer);

  function setToast(msg) {
    toastLayer.innerHTML = msg ? `<div class="toast" role="alert">${esc(msg)}</div>` : "";
    clearTimeout(setToast.t);
    if (msg) setToast.t = setTimeout(() => setToast(""), 4000);
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
      render(); // flights live in their own layer, so a redraw doesn't cut them short
    }
  }

  const act = (action) =>
    run(async () => {
      ui.sel = null;
      await transport.act(action);
    });

  // ---------- updates and animation ----------

  // Where a move's card was, as an element on screen right now.
  function sourceEl(move, v) {
    const pid = move.player;
    if (move.from.type === "stock") return main.querySelector(`[data-stock="${CSS.escape(pid)}"]`);
    if (move.from.type === "discard") return main.querySelector(`[data-discard="${CSS.escape(pid)}:${move.from.index}"]`);
    if (pid === v.me) return main.querySelector(`.hand [data-card="${move.card.id}"]`) || main.querySelector(".hand");
    return main.querySelector(`[data-hand="${CSS.escape(pid)}"]`);
  }
  function targetEl(move) {
    if (move.to.type === "build") return main.querySelector(`[data-build="${move.to.index}"]`);
    return main.querySelector(`[data-discard="${CSS.escape(move.player)}:${move.to.index}"]`);
  }

  function flyCard(card, from, to, { delay = 0, as = null, back = false } = {}) {
    if (!from || !to || reduceMotion()) return;
    const el = document.createElement("div");
    el.className = "fly";
    const w = Math.min(from.width, to.width * 1.3) || 60;
    el.style.cssText = `left:${from.left + (from.width - w) / 2}px;top:${from.top}px;--w:${w}px`;
    el.innerHTML = back ? `<div class="card back"><span class="sb">SKIP<br>BO</span></div>` : cardHtml(card, { as });
    fxLayer.append(el);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + w * 0.74);
    const scale = to.width && w ? Math.max(0.35, Math.min(1.2, to.width / w)) : 1;
    const anim = el.animate(
      [
        { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.08 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) rotate(-8deg) scale(1.1)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(${scale})`, opacity: 1 },
      ],
      { duration: 480, delay, easing: "cubic-bezier(0.3, 0.8, 0.3, 1)", fill: "backwards" }
    );
    anim.onfinish = anim.oncancel = () => el.remove();
  }

  // Captures where new moves start before the screen redraws, then flies the
  // cards once it has, one after another.
  function prepareMoves(prev, v) {
    if (!v || v.status === "lobby") return null;
    const fresh = (v.moves || []).filter((m) => ui.lastMove !== null && m.m > ui.lastMove);
    ui.lastMove = v.moveNo;
    if (!prev || prev.round !== v.round) return { moves: [], deal: true };
    const plays = fresh.map((m) => ({ m, from: m.to ? sourceEl(m, v)?.getBoundingClientRect() : null }));
    return { moves: plays };
  }

  function playMoves(info, v) {
    if (!info) return;
    let delay = 0;
    let completedAt = null;
    for (const { m, from } of info.moves) {
      if (m.draw) {
        if (m.player !== v.me) {
          const deck = main.querySelector(".draw-pile")?.getBoundingClientRect();
          const hand = main.querySelector(`[data-hand="${CSS.escape(m.player)}"]`)?.getBoundingClientRect();
          flyCard(null, deck, hand, { delay, back: true });
        }
        continue;
      }
      const to = targetEl(m)?.getBoundingClientRect();
      flyCard(m.card, from, to, { delay, as: m.card.kind === "wild" ? m.as : null });
      if (m.completed) completedAt = { rect: to, delay };
      delay += 380;
    }
    if (completedAt && completedAt.rect) {
      setTimeout(() => {
        const r = completedAt.rect;
        fx.confetti(70, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
        fx.shout("Pile complete!");
      }, completedAt.delay + 450);
    }
  }

  transport.init((snap) => {
    const prev = ui.snap.view;
    const same =
      snap.view && prev && ui.snap.code === snap.code && prev.seq === snap.view.seq && prev.me === snap.view.me && !ui.snap.offline === !snap.offline;
    if (snap.screen !== "game") ui.lastMove = null;
    const info = snap.screen === "game" ? prepareMoves(prev, snap.view) : null;
    ui.snap = snap;
    if (same) return;
    // Cards new to your hand slide in; a new round deals the whole hand.
    const mine = (v) => v && v.players.find((p) => p.id === v.me)?.hand;
    const had = new Set((mine(prev) || []).map((c) => c.id));
    ui.newCards = new Set((mine(snap.view) || []).filter((c) => !had.has(c.id)).map((c) => c.id));
    if (info && info.deal) ui.dealt = false;
    if (ui.sel && !selectedCard(snap.view)) ui.sel = null;
    render();
    playMoves(info, snap.view);
    celebrate(prev, snap.view);
  });

  function celebrate(prev, v) {
    if (!v || !prev || v.status === "lobby") return;
    const myTurn = v.status === "playing" && v.players[v.turn].id === v.me;
    const wasMine = prev.status === "playing" && prev.players[prev.turn]?.id === prev.me;
    if (v.status === "finished" && prev.status !== "finished") {
      // The results card names the winner; confetti is the celebration.
      fx.confetti(v.winners.includes(v.me) ? 260 : 120);
    } else if (myTurn && !wasMine) {
      fx.shout("Your turn");
      try {
        navigator.vibrate && navigator.vibrate(25);
      } catch {}
    }
  }

  // ---------- selection ----------

  function selectedCard(v) {
    if (!ui.sel || !v) return null;
    const me = v.players.find((p) => p.id === v.me);
    if (!me) return null;
    if (ui.sel.type === "stock") return me.stockTop;
    if (ui.sel.type === "discard") return me.discards[ui.sel.index]?.at(-1) || null;
    return me.hand?.find((c) => c.id === ui.sel.cardId) || null;
  }
  const isSel = (type, key) => ui.sel && ui.sel.type === type && (type === "stock" || (type === "hand" ? ui.sel.cardId === key : ui.sel.index === key));

  // ---------- screens ----------

  function heroCards() {
    const cards = [{ kind: "n", n: 1 }, { kind: "n", n: 5 }, { kind: "wild" }, { kind: "n", n: 9 }, { kind: "n", n: 12 }];
    return `<div class="hero-fan" aria-hidden="true">${cards.map((c, i) => cardHtml(c, { attrs: `style="--i:${i - 2}"` })).join("")}</div>`;
  }

  function webLinkHtml() {
    return transport.webUrl
      ? `<a class="btn big web-link" href="${esc(transport.webUrl)}" target="_blank" rel="noopener">Play on the web · no account needed</a>`
      : "";
  }

  function homeHtml() {
    const s = ui.snap;
    const nameVal = esc(ui.name ?? s.defaultName ?? "");
    const games = s.games || [];
    const joinBlock = transport.listsGames
      ? `<section class="panel"><h2>Open tables</h2>${
          games.length
            ? `<ul class="games">${games
                .map(
                  (g, i) => `<li>${avatarHtml(g.hostName, seatColor(i))}<div class="grow"><strong>${esc(g.hostName)}'s table</strong>
                    <span class="muted small">${g.players}/${MAX_PLAYERS} seated · ${esc(g.code)}</span></div>
                    <button type="button" class="btn ${g.mine ? "go" : ""}" data-join="${esc(g.code)}"${g.mine ? " data-mine" : ""}>${g.mine ? "Rejoin" : "Join"}</button></li>`
                )
                .join("")}</ul>`
            : `<p class="muted">No open tables yet. Start one and tell your friends to open this page.</p>`
        }</section>`
      : `<section class="panel"><h2>Got a code?</h2>
          <form id="join-form" class="row">
            <label class="grow"><span class="lbl">Room code</span>
              <input id="join-code" class="code-input" autocomplete="off" maxlength="5" placeholder="ABCDE" value="${esc(ui.code ?? s.prefillCode ?? "")}"></label>
            <button class="btn go" type="submit">Join</button>
          </form></section>`;
    return `<header class="hero">
        ${heroCards()}
        <p class="kicker">A card game for 2–${MAX_PLAYERS}</p>
        <h1 class="logo">Skip&#8209;Bo</h1>
        <p class="tagline-main">Build the middle piles from 1 to 12, or backwards from 12 to 1. First to empty their stock pile wins.</p>
      </header>
      <section class="panel">
        <label><span class="lbl">Your name</span>
          <input id="name" maxlength="20" autocomplete="nickname" value="${nameVal}" placeholder="What do your friends call you?"></label>
        <button type="button" class="btn primary big" data-do="create">Start a table</button>
        <button type="button" class="btn big ghost bots" data-do="solo">${BOT_ICON}Practice against 2 bots</button>
      </section>
      ${joinBlock}
      ${webLinkHtml()}
      <details class="panel rules"><summary>How to play</summary>${rulesHtml()}</details>`;
  }

  function rulesHtml() {
    return `<ul class="rule-list">
      <li><b>Goal</b><span>Be first to play every card in your stock pile. Only its top card is face up.</span></li>
      <li><b>Build</b><span>Four shared building piles go 1, 2, 3… up to 12, or in a backwards game 12, 11… down to 1. A finished pile is cleared and its cards are shuffled back in later.</span></li>
      <li><b>Skip-Bo</b><span>Wild cards stand in for any number.</span></li>
      <li><b>Your turn</b><span>You start with five cards in hand. Play from your hand, the top of your stock, or the top of your discard piles. Play all five and you draw five more.</span></li>
      <li><b>End</b><span>Finish your turn by putting one hand card on one of your four discard piles.</span></li>
    </ul>`;
  }

  // A server-provided on/off option; shown only when the view carries one.
  function tuneSwitchHtml(v) {
    const t = v && v.tune;
    if (!t) return "";
    return `<button type="button" class="tune-switch${t.on ? " on" : ""}" data-do="tune" role="switch" aria-checked="${!!t.on}"><span class="track"><span class="knob"></span></span>${esc(t.label)}</button>`;
  }

  function lobbyHtml(v) {
    const isHost = v.host === v.me;
    const code = String(ui.snap.code || "");
    const official = officialStock(Math.max(2, v.players.length));
    const choices = [
      { size: null, label: `Official · ${official}` },
      ...STOCK_CHOICES.filter((n) => n !== official).map((n) => ({ size: n, label: n === 10 ? "Quick · 10" : String(n) })),
    ];
    const current = v.stockSize ?? null;
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
            (p, i) => `<li class="${ui.seen.has(p.id) ? "" : "pop"}" style="--i:${i}">${avatarHtml(p.name, seatColor(i), p.bot)}
              <span class="seat-label">${esc(p.name)}</span>
              <span class="seat-sub">${p.bot ? "Bot" : ""}${p.id === v.host ? "Host" : ""}${p.id === v.me ? (p.id === v.host ? " · you" : "You") : ""}</span>
              ${isHost && p.id !== v.me ? `<button type="button" class="link small" data-kick="${esc(p.id)}">Remove</button>` : ""}</li>`
          )
          .join("")}${Array.from({ length: MAX_PLAYERS - v.players.length }, (_, k) =>
          isHost && k === 0
            ? `<li class="empty-seat"><button type="button" class="add-bot" data-do="add-bot"><span class="avatar ghost">+</span><span class="seat-label">Add a bot</span></button></li>`
            : `<li class="empty-seat"><span class="avatar ghost"></span></li>`
        ).join("")}</ul>
        <div class="option">
          <span class="lbl">Building piles</span>
          ${
            isHost
              ? `<div class="chips" role="group" aria-label="Building pile direction">${[
                  ["up", "Count up · 1→12"],
                  ["down", "Count down · 12→1"],
                ]
                  .map(([d, label]) => `<button type="button" class="chip${dirOf(v) === d ? " on" : ""}" data-dir="${d}">${label}</button>`)
                  .join("")}</div>`
              : `<p>${dirOf(v) === "down" ? "Counting down, 12 to 1" : "Counting up, 1 to 12"}</p>`
          }
        </div>
        <div class="option">
          <span class="lbl">Stock pile size</span>
          ${
            isHost
              ? `<div class="chips" role="group" aria-label="Stock pile size">${choices
                  .map((c) => `<button type="button" class="chip${c.size === current ? " on" : ""}" data-size="${c.size ?? ""}">${c.label}</button>`)
                  .join("")}</div>`
              : `<p>${current ? `${current} cards each` : `Official: ${official} cards each`}</p>`
          }
        </div>
        ${
          isHost
            ? `<button type="button" class="btn primary big" data-do="start" ${v.players.length < 2 ? "disabled" : ""}>
                ${v.players.length < 2 ? "Waiting for a friend…" : `Deal ${v.players.length} players in`}</button>`
            : `<p class="waiting"><span class="dots"><i></i><i></i><i></i></span>Waiting for ${esc(v.players.find((p) => p.id === v.host)?.name || "the host")} to deal</p>`
        }
        <div class="lobby-foot">
          <button type="button" class="link" data-do="leave">Leave table</button>
          ${tuneSwitchHtml(v)}
        </div>
      </section>`;
  }

  // Someone else's spot: their stock top and discard tops, all public.
  function opponentHtml(p, i, v) {
    const active = v.status === "playing" && i === v.turn;
    return `<li class="opp${active ? " active" : ""}" style="--seat:${seatColor(i)}">
      <div class="opp-head">${avatarHtml(p.name, seatColor(i), p.bot)}
        <strong class="opp-name">${esc(p.name)}</strong>
        <span class="opp-hand" data-hand="${esc(p.id)}" title="Cards in hand">${p.handCount}</span></div>
      <div class="opp-piles">
        <div class="mini-stock" data-stock="${esc(p.id)}" title="Stock: ${p.stockCount} left">
          ${p.stockTop ? cardHtml(p.stockTop, { cls: "mini" }) : `<div class="slot mini"></div>`}<b>${p.stockCount}</b></div>
        <div class="mini-discards">${p.discards
          .map((d, k) => `<div class="mini-discard" data-discard="${esc(p.id)}:${k}">${d.length ? cardHtml(d.at(-1), { cls: "mini" }) : `<div class="slot mini"></div>`}</div>`)
          .join("")}</div>
      </div></li>`;
  }

  function lastMoveHtml(v) {
    const m = [...(v.moves || [])].reverse().find((x) => x.to);
    if (!m || v.status !== "playing") return "";
    const p = v.players.find((x) => x.id === m.player);
    if (!p) return "";
    const who = p.id === v.me ? "You" : esc(p.name);
    const src = m.from.type === "stock" ? "Stock" : m.from.type === "discard" ? "Discard pile" : "Hand";
    const where = m.to.type === "build" ? `on pile ${m.to.index + 1}` : "to a discard pile";
    const verb = m.to.type === "build" ? "played" : "discarded";
    return `<p class="move-note"><span class="src src-${m.from.type}">${src}</span><span>${who} ${verb} ${cardHtml(m.card, { tag: "span", cls: "tiny", as: m.card.kind === "wild" && m.to.type === "build" ? m.as : null })} ${where}${m.completed ? " · pile done!" : ""}</span></p>`;
  }

  function gameHtml(v) {
    const meIdx = v.players.findIndex((p) => p.id === v.me);
    const me = v.players[meIdx];
    const myTurn = v.status === "playing" && v.turn === meIdx;
    const card = myTurn ? selectedCard(v) : null;
    const turnP = v.players[v.turn];

    const opps = v.players
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.id !== v.me)
      .map(({ p, i }) => opponentHtml(p, i, v))
      .join("");

    const build = v.build
      .map((pile, i) => {
        const top = pile.at(-1);
        const ok = card && fits(card, pile, dirOf(v));
        const cls = card ? (ok ? " ok" : " no") : "";
        return `<button type="button" class="build${cls}" data-build="${i}" ${card ? "" : 'tabindex="-1"'}
            aria-label="Building pile ${i + 1}: ${pile.length ? `${pile.length} cards` : "empty"}, needs ${nextFor(pile, dirOf(v))}">
          ${top ? cardHtml(top, { as: top.kind === "wild" ? top.as : null }) : `<div class="slot"><span>${nextFor(pile, dirOf(v))}</span></div>`}
          <span class="need">${pile.length ? `next ${nextFor(pile, dirOf(v))}` : "start"}</span></button>`;
      })
      .join("");

    let status;
    if (v.status !== "playing") status = "Game over";
    else if (myTurn) status = "Your turn";
    else status = `${esc(turnP.name)} is playing…`;

    const discards = me.discards
      .map((d, k) => {
        const top = d.at(-1);
        const under = d.at(-2);
        const target = myTurn && ui.sel?.type === "hand";
        return `<button type="button" class="my-discard${target ? " ok" : ""}${isSel("discard", k) ? " sel" : ""}" data-discard="${esc(me.id)}:${k}" data-my-discard="${k}"
            aria-label="Your discard pile ${k + 1}${top ? `, top card ${top.kind === "wild" ? "Skip-Bo" : top.n}` : ", empty"}">
          ${under ? cardHtml(under, { cls: "under" }) : ""}
          ${top ? cardHtml(top) : `<div class="slot"></div>`}
          ${d.length > 1 ? `<b class="count-badge">${d.length}</b>` : ""}</button>`;
      })
      .join("");

    const hand = (me.hand || [])
      .map((c, i) => cardHtml(c, { tag: "button", attrs: `type="button" data-card="${c.id}" style="--i:${i}"`, cls: `${isSel("hand", c.id) ? "sel" : ""} ${!ui.dealt || ui.newCards?.has(c.id) ? "deal" : ""}` }))
      .join("");
    ui.dealt = true;
    ui.newCards = null;

    const hint = !myTurn
      ? ""
      : ui.sel?.type === "hand"
        ? "Tap a glowing pile to play it, or one of your discard piles to end your turn."
        : ui.sel
          ? "Tap a glowing building pile."
          : "Tap a card, then where it goes. Discard to end your turn.";

    return `<div class="topbar">
        <span class="room">Room <b>${esc(ui.snap.code)}</b> · Round ${v.round}${ui.snap.offline ? ' <span class="offline">Reconnecting…</span>' : ""}</span>
        ${tuneSwitchHtml(v)}
        <button type="button" class="link" data-do="leave">Leave</button>
      </div>
      <ul class="opps">${opps}</ul>
      <section class="center">
        <div class="center-head">
          <span class="draw-pile" title="Draw pile">${v.drawCount}<small>to draw</small></span>
          <div class="center-mid">
            <p class="turn-pill${myTurn ? " mine" : ""}" aria-live="polite">${status}</p>
            <span class="dir-tag">${dirOf(v) === "down" ? "Counting down · 12→1" : "Counting up · 1→12"}</span>
          </div>
          <span class="done-pile" title="Finished cards waiting to be reshuffled">${v.completedCount}<small>finished</small></span>
        </div>
        <div class="builds">${build}</div>
        ${lastMoveHtml(v)}
      </section>
      <section class="dock${myTurn ? " mine" : ""}">
        <div class="dock-row">
          <button type="button" class="my-stock${isSel("stock") ? " sel" : ""}" data-stock="${esc(me.id)}" ${me.stockTop ? "" : "disabled"}
              aria-label="Your stock pile, ${me.stockCount} left">
            ${me.stockCount > 1 ? '<span class="stack-edge"></span>' : ""}
            ${me.stockTop ? cardHtml(me.stockTop) : `<div class="slot"></div>`}
            <b class="count-badge stock-count">${me.stockCount}</b>
            <span class="pile-label">Stock</span></button>
          <div class="my-discards">${discards}</div>
        </div>
        <p class="hint${myTurn ? " strong" : ""}">${hint}</p>
        <div class="hand">${hand}</div>
        ${myTurn && !(me.hand || []).length ? `<button type="button" class="btn" data-do="pass">No cards left · end turn</button>` : ""}
      </section>
      ${v.status === "finished" ? resultsHtml(v) : ""}`;
  }

  function resultsHtml(v) {
    const won = v.winners.includes(v.me);
    const names = v.winners.map((id) => v.players.find((p) => p.id === id)?.name || "Someone");
    const rows = v.players
      .map((p, i) => ({ p, i }))
      .sort((a, b) => a.p.stockCount - b.p.stockCount);
    return `<div class="overlay" role="dialog" aria-modal="true" aria-label="Game over"><div class="sheet">
        <p class="lbl">Round ${v.round} over</p>
        <h2 class="sheet-title">${won ? "You win" : `${esc(names.join(" & "))} ${names.length > 1 ? "win" : "wins"}`}</h2>
        <ul class="results">${rows
          .map(
            ({ p, i }) => `<li class="${v.winners.includes(p.id) ? "win" : ""}">${avatarHtml(p.name, seatColor(i), p.bot)}
              <div class="grow"><strong>${esc(p.name)}${p.id === v.me ? " (you)" : ""}</strong>
                <span class="r-sub">${p.stockCount ? `${p.stockCount} stock card${p.stockCount > 1 ? "s" : ""} left` : "Stock cleared"}</span></div>
              <span class="r-total">${p.wins}<small>${p.wins === 1 ? "win" : "wins"}</small></span></li>`
          )
          .join("")}</ul>
        <button type="button" class="btn primary big" data-do="restart">Play again</button>
        <button type="button" class="link" data-do="leave">Back to the start</button>
      </div></div>`;
  }

  function render() {
    if (drag && drag.moved) {
      drag.renderLater = true;
      return;
    }
    const s = ui.snap;
    let body;
    if (s.screen === "loading") body = `<div class="center-msg"><span class="dots"><i></i><i></i><i></i></span><p>${esc(s.message || "Loading…")}</p></div>`;
    else if (s.screen === "unavailable") body = `<section class="panel"><h1 class="logo small-logo">Skip&#8209;Bo</h1><p>${esc(s.message)}</p>${webLinkHtml()}</section>`;
    else if (s.screen === "home") body = homeHtml();
    else if (s.screen === "lost")
      body = `<section class="panel lost"><h2>Can't reach room ${esc(s.code)}</h2>
        <p class="muted">The game server didn't answer. Your game is saved, so you can try again, or start fresh.</p>
        <div class="row"><button type="button" class="btn primary grow" data-do="retry">Try again</button>
        <button type="button" class="btn grow" data-do="leave">Back to start</button></div></section>`;
    else if (s.view.status === "lobby") body = lobbyHtml(s.view);
    else body = gameHtml(s.view);
    if (s.screen !== "game" || s.view.status === "lobby") ui.dealt = false;
    const focusId = document.activeElement && document.activeElement.id;
    main.className = `wrap screen-${s.screen === "game" ? (s.view.status === "lobby" ? "lobby" : "game") : s.screen}${ui.busy ? " busy" : ""}`;
    main.innerHTML = body;
    if (s.view) for (const p of s.view.players) ui.seen.add(p.id);
    if (focusId) document.getElementById(focusId)?.focus();
  }

  // ---------- playing a card ----------

  // Plays or discards the selected card onto a target, by tap or by drop.
  function useTarget(target) {
    const v = ui.snap.view;
    if (!v || !ui.sel) return false;
    if (target.build !== undefined) {
      const from = ui.sel.type === "hand" ? { type: "hand", cardId: ui.sel.cardId } : { ...ui.sel };
      act({ type: "play", from, build: Number(target.build) });
      return true;
    }
    if (target.myDiscard !== undefined && ui.sel.type === "hand") {
      act({ type: "discard", cardId: ui.sel.cardId, pile: Number(target.myDiscard) });
      return true;
    }
    return false;
  }

  function select(sel) {
    const same = ui.sel && JSON.stringify(ui.sel) === JSON.stringify(sel);
    ui.sel = same ? null : sel;
    render();
  }

  // Drag a card from your hand, stock or discard pile onto a target.
  main.addEventListener("pointerdown", (e) => {
    const v = ui.snap.view;
    if (!v || v.status !== "playing" || v.players[v.turn].id !== v.me || e.button > 0) return;
    const el = e.target.closest(".hand .card, .my-stock, .my-discard");
    if (!el || el.disabled) return;
    let sel;
    if (el.dataset.card) sel = { type: "hand", cardId: Number(el.dataset.card) };
    else if (el.classList.contains("my-stock")) sel = { type: "stock" };
    else {
      const k = Number(el.dataset.myDiscard);
      if (!v.players.find((p) => p.id === v.me).discards[k].length) return;
      sel = { type: "discard", index: k };
    }
    drag = { el, sel, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  });

  addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 10) return;
      drag.moved = true;
      ui.sel = drag.sel;
      const cardEl = drag.el.matches(".card") ? drag.el : drag.el.querySelector(".card:not(.under)");
      const r = (cardEl || drag.el).getBoundingClientRect();
      drag.ghost = document.createElement("div");
      drag.ghost.className = "fly dragging";
      drag.ghost.style.cssText = `left:${r.left}px;top:${r.top}px;--w:${r.width}px`;
      drag.ghost.innerHTML = cardEl ? cardEl.outerHTML : "";
      drag.offset = { x: drag.x - r.left, y: drag.y - r.top };
      fxLayer.append(drag.ghost);
      (cardEl || drag.el).classList.add("lifted");
      drag.renderLater = false;
      markTargets();
    }
    e.preventDefault();
    drag.ghost.style.left = `${e.clientX - drag.offset.x}px`;
    drag.ghost.style.top = `${e.clientY - drag.offset.y}px`;
    const over = dropTargetAt(e.clientX, e.clientY);
    main.querySelectorAll(".hover").forEach((x) => x !== over && x.classList.remove("hover"));
    if (over) over.classList.add("hover");
  });

  function dropTargetAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest("[data-build], [data-my-discard]");
    return el && main.contains(el) ? el : null;
  }

  // Highlights where the dragged card can go without a full redraw.
  function markTargets() {
    const v = ui.snap.view;
    const card = selectedCard(v);
    main.querySelectorAll("[data-build]").forEach((el) => {
      const ok = card && fits(card, v.build[Number(el.dataset.build)], dirOf(v));
      el.classList.toggle("ok", !!ok);
      el.classList.toggle("no", !ok);
    });
    main.querySelectorAll("[data-my-discard]").forEach((el) => el.classList.toggle("ok", ui.sel?.type === "hand"));
  }

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    d.ghost.remove();
    ui.justDragged = true;
    setTimeout(() => (ui.justDragged = false), 300);
    const over = e.type === "pointerup" ? dropTargetAt(e.clientX, e.clientY) : null;
    if (!over || !useTarget(over.dataset)) {
      ui.sel = null;
      render();
    }
  }
  addEventListener("pointerup", endDrag);
  addEventListener("pointercancel", endDrag);

  // ---------- events ----------

  const nameValue = () => (document.getElementById("name")?.value || "").trim();

  root.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || t.disabled || !main.contains(t) || ui.justDragged) return;
    const d = t.dataset;
    const v = ui.snap.view;
    const myTurn = v && v.status === "playing" && v.players[v.turn].id === v.me;

    if (d.build !== undefined) {
      if (!myTurn) return;
      if (!ui.sel) return setToast("Pick a card first: your hand, stock or a discard pile.");
      useTarget(d);
      return;
    }
    if (d.myDiscard !== undefined) {
      if (!myTurn) return;
      if (ui.sel?.type === "hand") return useTarget(d);
      const k = Number(d.myDiscard);
      if (!v.players.find((p) => p.id === v.me).discards[k].length) return;
      return select({ type: "discard", index: k });
    }
    if (t.classList.contains("my-stock")) return myTurn && select({ type: "stock" });
    if (d.card !== undefined) return myTurn ? select({ type: "hand", cardId: Number(d.card) }) : setToast("Wait for your turn.");
    if (d.size !== undefined) return act({ type: "stockSize", size: d.size === "" ? null : Number(d.size) });
    if (d.dir) return act({ type: "direction", dir: d.dir });
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
      case "solo": {
        const name = nameValue();
        if (!name) return setToast("Enter your name first.");
        return run(async () => {
          await transport.createGame(name);
          await transport.act({ type: "addBot" });
          await transport.act({ type: "addBot" });
          await transport.act({ type: "stockSize", size: 20 });
          await transport.act({ type: "start" });
        });
      }
      case "add-bot":
        return act({ type: "addBot" });
      case "start":
        return act({ type: "start" });
      case "restart":
        return act({ type: "restart" });
      case "pass":
        return act({ type: "pass" });
      case "tune":
        return act({ type: "tune", on: !v.tune.on });
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
        ui.sel = null;
        return run(() => transport.leave());
    }
  });

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
