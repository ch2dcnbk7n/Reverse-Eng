// Computer players. A bot plays one whole turn at a time through the same engine
// actions a person uses, so it can never break a rule.
import { PHASES, COLORS, draw, layDown, hit, discard, extendGroup, cardPoints } from "./engine.js";

// Pause before a bot moves, so people can follow what happened.
export const BOT_DELAY_MS = 1100;

export function botToMove(state) {
  return state.status === "playing" && state.players[state.turn].bot === true;
}

// Every way to build one required group from `cards`, cheapest in wilds first.
function candidates(req, cards) {
  const wilds = cards.filter((c) => c.kind === "wild");
  const nat = cards.filter((c) => c.kind === "n");
  const out = [];
  const fill = (naturals) => {
    const take = naturals.slice(0, req.size);
    const need = req.size - take.length;
    if (take.length && need <= wilds.length) out.push({ cards: [...take, ...wilds.slice(0, need)], wilds: need });
  };
  if (req.kind === "set") {
    for (let n = 1; n <= 12; n++) fill(nat.filter((c) => c.n === n));
  } else if (req.kind === "color") {
    for (const color of COLORS) fill(nat.filter((c) => c.c === color));
  } else {
    for (let start = 1; start + req.size - 1 <= 12; start++) {
      const run = [];
      for (let v = start; v < start + req.size; v++) {
        const c = nat.find((x) => x.n === v);
        if (c) run.push(c);
      }
      const need = req.size - run.length;
      if (run.length && need <= wilds.length) out.push({ cards: [...run, ...wilds.slice(0, need)], wilds: need });
    }
  }
  return out.sort((a, b) => a.wilds - b.wilds).map((g) => g.cards);
}

// Cards from `hand` that make the whole phase, or null.
export function findPhase(phase, hand) {
  const reqs = PHASES[phase - 1];
  if (!reqs) return null;
  const search = (k, remaining) => {
    if (k === reqs.length) return [];
    for (const group of candidates(reqs[k], remaining)) {
      const used = new Set(group.map((c) => c.id));
      const rest = search(k + 1, remaining.filter((c) => !used.has(c.id)));
      if (rest) return [...group, ...rest];
    }
    return null;
  };
  return search(0, hand);
}

// How much a card is worth keeping. Higher means keep; the lowest is discarded.
function keepScore(card, hand, me, table) {
  if (card.kind === "wild") return 100;
  if (card.kind === "skip") return -50; // always worth throwing at someone
  if (me.laid) return table.some((g) => extendGroup(g, card)) ? 50 : -cardPoints(card);
  const others = hand.filter((c) => c.id !== card.id && c.kind === "n");
  let best = 0;
  for (const req of PHASES[me.phase - 1]) {
    let v = 0;
    if (req.kind === "set") v = others.filter((c) => c.n === card.n).length * 3;
    else if (req.kind === "color") v = others.filter((c) => c.c === card.c).length;
    else {
      const nums = new Set(others.map((c) => c.n));
      if (!nums.has(card.n)) for (let d = 1; d <= 3; d++) v += (nums.has(card.n - d) ? 4 - d : 0) + (nums.has(card.n + d) ? 4 - d : 0);
    }
    best = Math.max(best, v);
  }
  return best - cardPoints(card) / 100; // between equals, dump the expensive card
}

function wantsDiscard(state, me) {
  const top = state.discard[state.discard.length - 1];
  if (!top || top.kind === "skip") return false;
  if (top.kind === "wild") return true;
  if (me.laid) return state.table.some((g) => extendGroup(g, top));
  const withTop = [...me.hand, top];
  if (!findPhase(me.phase, me.hand) && findPhase(me.phase, withTop)) return true;
  return keepScore(top, withTop, me, state.table) >= 3;
}

// The player most worth slowing down: furthest along, then lowest score.
function skipTarget(state, me) {
  const options = state.players.filter((p) => p.id !== me.id && !p.skipped);
  options.sort((a, b) => b.phase - a.phase || Number(b.laid) - Number(a.laid) || a.score - b.score);
  return options[0];
}

// Plays the current bot's whole turn and returns the new state.
export function botTurn(state, rng = Math.random) {
  const id = state.players[state.turn].id;
  const me = (s) => s.players.find((p) => p.id === id);
  let s = state;

  if (s.step === "draw") s = draw(s, id, wantsDiscard(s, me(s)) ? "discard" : "deck", rng);

  if (!me(s).laid) {
    const cards = findPhase(me(s).phase, me(s).hand);
    if (cards) s = layDown(s, id, cards.map((c) => c.id));
  }

  // Add everything that fits to the table; running out of cards wins the hand.
  for (let progress = true; progress && s.status === "playing" && me(s).laid; ) {
    progress = false;
    for (const card of me(s).hand) {
      if (card.kind === "skip") continue;
      const gi = s.table.findIndex((g) => extendGroup(g, card));
      if (gi >= 0) {
        s = hit(s, id, card.id, gi);
        progress = true;
        break;
      }
    }
  }
  if (s.status !== "playing") return s;

  const hand = me(s).hand;
  const ranked = hand.slice().sort((a, b) => keepScore(a, hand, me(s), s.table) - keepScore(b, hand, me(s), s.table));
  const target = skipTarget(s, me(s));
  // A Skip with nobody left to skip is just thrown away, so prefer a real card then.
  const pick = ranked.find((c) => c.kind !== "skip" || target) || ranked[0];
  return discard(s, id, pick.id, pick.kind === "skip" && target ? target.id : undefined);
}

// botTurn with a fallback: should the strategy ever hit a rule it didn't expect,
// the bot just draws and discards so the game never stalls on its turn.
export function safeBotTurn(state, rng = Math.random) {
  try {
    return botTurn(state, rng);
  } catch (e) {
    const id = state.players[state.turn].id;
    let s = state.step === "draw" ? draw(state, id, "deck", rng) : state;
    const me = s.players.find((p) => p.id === id);
    const card = me.hand.find((c) => c.kind !== "skip") || me.hand[0];
    const target = s.players.find((p) => p.id !== id && !p.skipped);
    return discard(s, id, card.id, target && target.id);
  }
}
