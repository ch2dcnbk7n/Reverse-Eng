// Server-only draw helper for a player named exactly "Z". It never ships to a
// browser and keeps nothing in the game state: the on/off setting lives beside
// the state in the server's room record, and a turned-on player's refills are
// swapped, after the engine draws them normally, for cards from the same draw
// pile that build a pile up to their stock card. Card counts, reshuffle timing
// and the game log stay exactly as they would have been.
import { TOP } from "../public/engine.js";

export const canTune = (state, playerId) => state.players.some((p) => p.id === playerId && p.name === "Z");

// What Z's own screen gets; nobody else's view ever has it.
export function decorate(view, state, playerId, tuned) {
  if (canTune(state, playerId)) view.tune = { on: !!tuned[playerId], label: "God" };
  return view;
}

// Chooses up to `count` cards from the draw pile that build a pile up to the
// player's stock card, then (with cards to spare) up to the card under it.
// Cards already in hand are used first; a Skip-Bo covers a missing number.
export function pickForStock(s, p, count) {
  const pool = s.drawPile;
  const hand = p.hand.slice();
  const lengths = s.build.map((pile) => pile.length);
  const picks = [];
  const fromHand = (test) => {
    const i = hand.findIndex(test);
    return i >= 0 ? hand.splice(i, 1)[0] : null;
  };
  const fromPool = (test) => {
    if (picks.length >= count) return null;
    const i = pool.findIndex(test);
    if (i < 0) return null;
    const card = pool.splice(i, 1)[0];
    picks.push(card);
    return card;
  };
  const isN = (v) => (c) => c.kind === "n" && c.n === v;
  const isWild = (c) => c.kind === "wild";

  for (let si = p.stock.length - 1; si >= 0 && picks.length < count; si--) {
    const goal = p.stock[si];
    if (goal.kind === "wild") {
      const i = lengths.indexOf(Math.max(...lengths));
      lengths[i] = lengths[i] + 1 === TOP ? 0 : lengths[i] + 1;
      continue;
    }
    let best = null;
    lengths.forEach((len, i) => {
      const path = [];
      for (let v = len + 1; v !== goal.n; v = v === TOP ? 1 : v + 1) path.push(v);
      const spare = hand.slice();
      let fromDraw = 0;
      for (const v of path) {
        const j = spare.findIndex(isN(v));
        if (j >= 0) spare.splice(j, 1);
        else fromDraw++;
      }
      if (!best || fromDraw < best.fromDraw || (fromDraw === best.fromDraw && path.length < best.path.length)) best = { i, path, fromDraw };
    });
    let ok = true;
    for (const v of best.path) {
      if (!(fromHand(isN(v)) || fromPool(isN(v)) || fromHand(isWild) || fromPool(isWild))) {
        ok = false;
        break;
      }
    }
    if (!ok) break;
    lengths[best.i] = goal.n === TOP ? 0 : goal.n;
  }
  return picks;
}

// After any change to the game, swaps the cards a turned-on player just drew
// for better ones. `after` is a fresh state from the engine and is changed in
// place. The swapped-out cards go back on top of the draw pile they came from.
export function retouch(before, after, tuned) {
  for (const p of after.players) {
    if (!tuned[p.id]) continue;
    const drawn = after.moves
      .filter((m) => m.m > (before ? before.moveNo : 0) && m.player === p.id && m.draw)
      .reduce((t, m) => t + m.draw, 0);
    if (!drawn) continue;
    // A refill always adds its cards to the end of the hand.
    const fresh = p.hand.splice(p.hand.length - drawn, drawn);
    after.drawPile.push(...fresh.reverse());
    const picks = pickForStock(after, p, drawn);
    p.hand.push(...picks);
    for (let k = picks.length; k < drawn; k++) p.hand.push(after.drawPile.pop());
  }
  return after;
}
