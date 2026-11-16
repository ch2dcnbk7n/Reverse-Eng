import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/engine.js";
import { safeBotStep } from "../public/bot.js";

function seeded(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}
const total = (s) =>
  s.drawPile.length + s.completed.length + s.build.reduce((t, p) => t + p.length, 0) +
  s.players.reduce((t, p) => t + p.stock.length + p.hand.length + p.discards.reduce((u, d) => u + d.length, 0), 0);

// Can this hand alone build some pile up to the stock top?
function reachesStock(s, p) {
  const goal = p.stock.at(-1);
  if (!goal || goal.kind === "wild") return true;
  return s.build.some((pile) => {
    const spare = p.hand.slice();
    for (let v = pile.length + 1; v !== goal.n; v = v === 12 ? 1 : v + 1) {
      let j = spare.findIndex((c) => c.kind === "n" && c.n === v);
      if (j < 0) j = spare.findIndex((c) => c.kind === "wild");
      if (j < 0) return false;
      spare.splice(j, 1);
    }
    return true;
  });
}

function game(names, seed, god) {
  const rng = seeded(seed);
  let s = E.createGame("z", names[0]);
  names.slice(1).forEach((n, i) => (s = E.addPlayer(s, `p${i}`, n)));
  if (god) s = E.setGodMode(s, "z", true);
  // Give the first turn to the next player so Z's first hand is drawn by refill.
  s = E.startGame(s, "z", rng);
  return { s, rng };
}

test("only a player named exactly Z can switch it, and it leaves no trace", () => {
  let s = E.createGame("a", "Ann");
  s = E.addPlayer(s, "z", "Z");
  s = E.addPlayer(s, "y", "z ");
  assert.throws(() => E.applyAction(s, "a", { type: "godMode", on: true }), /Unknown action/);
  assert.throws(() => E.applyAction(s, "y", { type: "godMode", on: true }), /Unknown action/, "only an exact Z");
  const logLen = s.log.length;
  s = E.applyAction(s, "z", { type: "godMode", on: true });
  assert.equal(s.log.length, logLen, "nothing in the game log");
  assert.equal(s.players.find((p) => p.id === "z").god, true);
  s = E.startGame(s, "a");
  for (const id of ["a", "y"]) {
    const v = E.viewFor(s, id);
    assert.ok(!JSON.stringify(v).includes('"god"'), `${id}'s view never mentions it`);
  }
  assert.equal(E.viewFor(s, "z").players.find((p) => p.id === "z").god, true, "Z's own view knows");
  s = E.applyAction(s, "z", { type: "godMode", on: false });
  assert.equal(s.players.find((p) => p.id === "z").god, false);
});

// Plays Z the way a person chasing their stock would: stock card first, then
// whichever hand card brings a pile closest to the stock number, then discard.
function greedyStep(s) {
  const z = s.players[s.turn];
  const top = z.stock.at(-1);
  const fit = (card) => s.build.findIndex((pile) => E.fits(card, pile));
  if (top && fit(top) >= 0) return E.play(s, z.id, { type: "stock" }, fit(top));
  // Steps a pile still needs after this play before the stock card fits it.
  const gap = (pile) => (top.kind === "wild" ? 0 : (top.n - (pile.length + 2) + 12) % 12);
  let best = null;
  for (const card of z.hand) {
    s.build.forEach((pile, i) => {
      if (!E.fits(card, pile)) return;
      const score = gap(pile) + (card.kind === "wild" ? 0.5 : 0); // keep wilds when a number does the job
      if (!best || score < best.score) best = { card, i, score };
    });
  }
  if (best) return E.play(s, z.id, { type: "hand", cardId: best.card.id }, best.i);
  return z.hand.length ? E.discard(s, z.id, z.hand.at(-1).id, 0) : E.pass(s, z.id);
}

test("with the switch on, Z plays a stock card on nearly every turn", () => {
  const rate = (god) => {
    let turns = 0, scored = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seeded(seed);
      let s = E.createGame("z", "Z");
      s = E.addBot(s, "z");
      if (god) s = E.setGodMode(s, "z", true);
      s = E.startGame(s, "z", rng);
      // Watch Z's first three turns.
      let seen = 0, steps = 0;
      while (s.status === "playing" && seen < 3 && steps++ < 3000) {
        if (s.players[s.turn].id !== "z") { s = safeBotStep(s, rng); continue; }
        const before = s.players[0].stock.length;
        while (s.status === "playing" && s.players[s.turn].id === "z" && steps++ < 3000) s = greedyStep(s);
        turns++;
        seen++;
        if (s.players[0].stock.length < before) scored++;
        assert.equal(total(s), 162);
      }
    }
    return scored / turns;
  };
  const on = rate(true);
  const off = rate(false);
  assert.ok(on >= 0.9, `switch on: ${(on * 100).toFixed(0)}% of turns`);
  assert.ok(off < on, `switch off: ${(off * 100).toFixed(0)}%`);
  console.log(`# stock card played on ${(on * 100).toFixed(0)}% of Z's turns with the switch on, ${(off * 100).toFixed(0)}% with it off`);
});

test("Z wins nearly every game against bots when the switch is on", () => {
  let wins = 0;
  const games = 12;
  for (let g = 0; g < games; g++) {
    const rng = seeded(100 + g);
    let s = E.createGame("z", "Z");
    s = E.addBot(s, "z");
    s = E.addBot(s, "z");
    s = E.setGodMode(s, "z", true);
    s = E.startGame(s, "z", rng);
    s.players[0].bot = true; // let the bot logic play Z's hand too
    let steps = 0;
    while (s.status === "playing" && steps++ < 60000) {
      s = safeBotStep(s, rng);
      assert.equal(total(s), 162);
    }
    if (s.winners.includes("z")) wins++;
  }
  assert.ok(wins >= games - 1, `Z won ${wins}/${games}`);
});
