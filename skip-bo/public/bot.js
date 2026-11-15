// Computer players. A bot makes one move at a time (a play or its closing
// discard) through the same engine actions a person uses, so other players can
// watch each card land and the bot can never break a rule.
import { PILES, TOP, nextFor, fits, play, discard, pass } from "./engine.js";

// Pause before each bot move.
export const BOT_DELAY_MS = 700;

export function botToMove(state) {
  return state.status === "playing" && state.players[state.turn].bot === true;
}

// Every card the bot could play this moment, with where it comes from.
function sources(me) {
  const out = [];
  if (me.stock.length) out.push({ from: { type: "stock" }, card: me.stock[me.stock.length - 1] });
  me.discards.forEach((pile, index) => {
    if (pile.length) out.push({ from: { type: "discard", index }, card: pile[pile.length - 1] });
  });
  for (const card of me.hand) out.push({ from: { type: "hand", cardId: card.id }, card });
  return out;
}

// The stock top of the player after this one: never hand them their card.
function nextStockTop(state) {
  const next = state.players[(state.turn + 1) % state.players.length];
  const top = next.stock[next.stock.length - 1];
  return top && top.kind === "n" ? top.n : null;
}

// Picks this bot's next play, or null when it should discard instead.
export function choosePlay(state) {
  const me = state.players[state.turn];
  const piles = state.build;
  const all = sources(me);
  const stockTop = me.stock[me.stock.length - 1];
  const danger = nextStockTop(state);

  // 1. Play the stock card whenever it fits; that's how you win.
  if (stockTop) {
    const target = piles.findIndex((p) => fits(stockTop, p));
    if (target >= 0) {
      // A Skip-Bo from the stock goes on the pile closest to finishing.
      const best = stockTop.kind === "wild" ? bestPileForWild(piles, danger) : target;
      return { from: { type: "stock" }, build: best };
    }
  }

  const naturals = all.filter((s) => s.card.kind === "n" && s.from.type !== "stock");
  const wilds = all.filter((s) => s.card.kind === "wild" && s.from.type !== "stock");

  // 2. Build a pile up towards the stock card, cheapest first. A pile already
  //    past the stock number can still get there: finish it at 12, then it
  //    starts again from 1.
  if (stockTop && stockTop.kind === "n") {
    const goal = stockTop.n;
    let best = null;
    piles.forEach((pile, i) => {
      const need = nextFor(pile);
      const path = [];
      for (let v = need; v !== goal; v = v === TOP ? 1 : v + 1) path.push(v);
      // Can every step on the way be covered?
      const gap = path.filter((v) => !naturals.some((s) => s.card.n === v)).length;
      if (gap > wilds.length) return;
      if (!best || path.length < best.steps) best = { pile: i, need, steps: path.length };
    });
    if (best) {
      const natural = preferDiscards(naturals.filter((s) => s.card.n === best.need));
      const pick = natural || preferDiscards(wilds);
      return { from: pick.from, build: best.pile };
    }
  }

  // 3. Clear naturals from the discard piles and hand when that's safe, so
  //    the hand empties and refills. Discard tops go first to dig deeper.
  const safe = [];
  for (const s of all) {
    if (s.card.kind !== "n" || s.from.type === "stock") continue;
    piles.forEach((pile, i) => {
      if (!fits(s.card, pile)) return;
      const after = s.card.n === TOP ? 1 : s.card.n + 1; // a 12 finishes the pile
      if (danger && after === danger) return; // would set up the next player
      safe.push({ ...s, build: i });
    });
  }
  const fromDiscard = safe.find((s) => s.from.type === "discard");
  const pick = fromDiscard || safe.find((s) => s.from.type === "hand");
  if (pick) return { from: pick.from, build: pick.build };

  // 4. With no cards left to discard the turn would just pass, so any legal
  //    play beats waiting, even one that helps the next player.
  if (!me.hand.length) {
    for (const s of [...naturals, ...wilds]) {
      const i = piles.findIndex((p) => fits(s.card, p));
      if (i >= 0) return { from: s.from, build: i };
    }
  }
  return null;
}

function preferDiscards(list) {
  return list.find((s) => s.from.type === "discard") || list[0] || null;
}

function bestPileForWild(piles, danger) {
  let best = 0;
  let bestLen = -1;
  piles.forEach((pile, i) => {
    if (danger && nextFor(pile) + 1 === danger) return;
    if (pile.length > bestLen) {
      best = i;
      bestLen = pile.length;
    }
  });
  return best;
}

// Ends the turn: keep Skip-Bo cards, stack runs downwards on discard piles
// (a 7 on an 8) so they come back in order, and dump high cards first.
export function chooseDiscard(state) {
  const me = state.players[state.turn];
  if (!me.hand.length) return null;
  const naturals = me.hand.filter((c) => c.kind === "n");
  const pool = naturals.length ? naturals : me.hand;
  let best = null;
  for (const card of pool) {
    for (let i = 0; i < PILES; i++) {
      const pile = me.discards[i];
      const top = pile[pile.length - 1];
      let score = card.kind === "n" ? card.n / 2 : 0;
      if (!top) score += 4;
      else if (top.kind === "n" && card.kind === "n" && top.n === card.n + 1) score += 8;
      else if (top.kind === "n" && card.kind === "n" && top.n === card.n) score += 6;
      else score -= pile.length; // don't bury long piles
      if (!best || score > best.score) best = { cardId: card.id, pile: i, score };
    }
  }
  return best;
}

// Plays one move for the current bot and returns the new state.
export function botStep(state, rng = Math.random) {
  const me = state.players[state.turn];
  const move = choosePlay(state);
  if (move) return play(state, me.id, move.from, move.build, rng);
  const d = chooseDiscard(state);
  if (d) return discard(state, me.id, d.cardId, d.pile, rng);
  return pass(state, me.id, rng);
}

// botStep with a fallback: if the strategy ever trips on a rule, just discard
// so the game never stalls on a bot's turn.
export function safeBotStep(state, rng = Math.random) {
  try {
    return botStep(state, rng);
  } catch {
    const me = state.players[state.turn];
    if (me.hand.length) return discard(state, me.id, me.hand[0].id, 0, rng);
    return pass(state, me.id, rng);
  }
}
