import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/engine.js";
import { botStep, botToMove, safeBotStep, choosePlay } from "../public/bot.js";

let nextId = 5000;
const n = (num) => ({ id: nextId++, kind: "n", n: num });
const W = () => ({ id: nextId++, kind: "wild" });
function seeded(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}
const total = (s) =>
  s.drawPile.length +
  s.completed.length +
  s.build.reduce((t, p) => t + p.length, 0) +
  s.players.reduce((t, p) => t + p.stock.length + p.hand.length + p.discards.reduce((u, d) => u + d.length, 0), 0);

function started(ids = ["a", "b"], seed = 3) {
  let s = E.createGame(ids[0], ids[0].toUpperCase());
  for (const id of ids.slice(1)) s = E.addPlayer(s, id, id.toUpperCase());
  return E.startGame(s, ids[0], seeded(seed));
}

test("deck: 144 numbered cards, twelve of each, plus 18 Skip-Bo cards", () => {
  const d = E.buildDeck();
  assert.equal(d.length, 162);
  assert.equal(d.filter((c) => c.kind === "wild").length, 18);
  for (let v = 1; v <= 12; v++) assert.equal(d.filter((c) => c.n === v).length, 12);
});

test("deal: official stock sizes, five cards to the first player, all cards accounted for", () => {
  let s = started(["a", "b", "c"]);
  assert.ok(s.players.every((p) => p.stock.length === 30));
  assert.equal(s.players[s.turn].hand.length, 5);
  assert.equal(total(s), 162);

  let six = E.createGame("a", "A");
  for (const id of ["b", "c", "d", "e"]) six = E.addPlayer(six, id, id);
  six = E.addBot(six, "a");
  six = E.startGame(six, "a", seeded(1));
  assert.ok(six.players.every((p) => p.stock.length === 20), "5 or more players get 20");

  let quick = E.setStockSize(E.addPlayer(E.createGame("a", "A"), "b", "B"), "a", 10);
  quick = E.startGame(quick, "a");
  assert.ok(quick.players.every((p) => p.stock.length === 10));
  assert.throws(() => E.setStockSize(E.createGame("a", "A"), "a", 7), /10, 20 or 30/);
});

test("plays follow the building rules", () => {
  let s = started();
  const me = s.players[s.turn];
  me.hand = [n(1), n(3), W(), n(2), n(5)];
  const [one, three, wild, two] = me.hand;
  assert.throws(() => E.play(s, me.id, { type: "hand", cardId: three.id }, 0), /starts with a 1/);
  s = E.play(s, me.id, { type: "hand", cardId: one.id }, 0);
  assert.throws(() => E.play(s, me.id, { type: "hand", cardId: three.id }, 0), /needs a 2/);
  s = E.play(s, me.id, { type: "hand", cardId: wild.id }, 0);
  assert.equal(s.build[0].at(-1).as, 2, "the Skip-Bo counts as a 2");
  s = E.play(s, me.id, { type: "hand", cardId: three.id }, 0);
  assert.equal(s.build[0].length, 3);
  assert.throws(() => E.play(s, me.id, { type: "hand", cardId: two.id }, 1), /starts with a 1/);
  assert.equal(s.moves.at(-1).to.index, 0);
});

test("only the player whose turn it is can move", () => {
  const s = started();
  const other = s.players[(s.turn + 1) % 2];
  assert.throws(() => E.discard(s, other.id, 1, 0), /turn/);
});

test("playing from the stock and from discard piles", () => {
  let s = started();
  const me = s.players[s.turn];
  me.stock.push(n(1));
  me.discards[2] = [n(9), n(2)];
  s = E.play(s, me.id, { type: "stock" }, 3);
  s = E.play(s, me.id, { type: "discard", index: 2 }, 3);
  const p = s.players[s.turn];
  assert.deepEqual(s.build[3].map((c) => c.n), [1, 2]);
  assert.equal(p.discards[2].length, 1);
  assert.equal(p.stock.length, 30);
  assert.throws(() => E.play(s, me.id, { type: "discard", index: 0 }, 0), /empty/);
});

test("a finished pile is cleared and its cards reshuffled later", () => {
  let s = started();
  const me = s.players[s.turn];
  s.build[1] = Array.from({ length: 11 }, (_, i) => ({ ...n(i + 1), as: i + 1 }));
  // keep the count honest: take those cards out of the draw pile
  s.drawPile.splice(0, 11);
  me.hand[0] = n(12);
  s.drawPile.pop();
  s = E.play(s, me.id, { type: "hand", cardId: me.hand[0].id }, 1);
  assert.equal(s.build[1].length, 0);
  assert.equal(s.completed.length, 12);
  assert.ok(s.moves.at(-1).completed);
  assert.ok(s.completed.every((c) => c.as === undefined), "wild values are forgotten");
  // empty the draw pile and end the turn: the next player draws from the reshuffle
  const next = s.players[(s.turn + 1) % 2];
  s.drawPile = [];
  next.hand = [];
  s = E.discard(s, me.id, s.players[s.turn].hand[0].id, 0);
  assert.equal(s.players[s.turn].hand.length, 5);
  assert.equal(s.completed.length, 0);
  assert.equal(s.drawPile.length, 7);
});

test("emptying your hand mid-turn draws five more", () => {
  let s = started();
  const me = s.players[s.turn];
  me.hand = [n(1)];
  s = E.play(s, me.id, { type: "hand", cardId: me.hand[0].id }, 0);
  assert.equal(s.players[s.turn].hand.length, 5);
  assert.equal(s.moves.at(-1).draw, 5);
});

test("discarding ends the turn and fills the next player's hand", () => {
  let s = started(["a", "b", "c"], 9);
  const me = s.players[s.turn];
  const card = me.hand[0];
  const turn = s.turn;
  s = E.discard(s, me.id, card.id, 3);
  assert.equal(s.players[turn].discards[3].at(-1).id, card.id);
  assert.equal(s.turn, (turn + 1) % 3);
  assert.equal(s.players[s.turn].hand.length, 5);
  assert.throws(() => E.pass(s, s.players[s.turn].id), /discarding/);
});

test("playing your last stock card wins; restart deals a new round", () => {
  let s = started();
  const me = s.players[s.turn];
  me.stock = [n(1)];
  s = E.play(s, me.id, { type: "stock" }, 0);
  assert.equal(s.status, "finished");
  assert.deepEqual(s.winners, [me.id]);
  assert.equal(s.players.find((p) => p.id === me.id).wins, 1);
  assert.throws(() => E.play(s, me.id, { type: "stock" }, 0), /in progress/);
  s = E.restart(s, me.id, seeded(4));
  assert.equal(s.status, "playing");
  assert.equal(s.round, 2);
  assert.equal(s.players.find((p) => p.id === me.id).wins, 1, "wins carry over");
  assert.equal(total(s), 162);
});

test("viewFor hides hands, stock pile order and the draw pile", () => {
  const s = started(["a", "b"]);
  const v = E.viewFor(s, "a");
  assert.equal(v.drawPile, undefined);
  assert.equal(v.drawCount, s.drawPile.length);
  for (const p of v.players) {
    assert.equal(p.stock, undefined);
    assert.equal(p.stockCount, 30);
    assert.ok(p.stockTop);
    assert.equal(p.hand === undefined, p.id !== "a");
  }
});

test("lobby: host-only controls, bots, leaving", () => {
  let s = E.createGame("a", "Ann");
  assert.throws(() => E.startGame(s, "a"), /at least 2/);
  s = E.addPlayer(s, "b", "Bo");
  assert.throws(() => E.addBot(s, "b"), /Only the host/);
  assert.throws(() => E.setStockSize(s, "b", 10), /Only the host/);
  for (let i = 0; i < 4; i++) s = E.addBot(s, "a");
  assert.throws(() => E.addBot(s, "a"), /full/);
  s = E.removePlayer(s, "a", "a");
  assert.equal(s.host, "b");
  assert.throws(() => E.applyAction(s, "b", { type: "nope" }), E.GameError);
});

test("bots always play their stock card when it fits", () => {
  let s = started(["a", "b"], 5);
  s.players[s.turn].bot = true;
  const me = s.players[s.turn];
  me.stock.push(n(1));
  assert.ok(botToMove(s));
  assert.deepEqual(choosePlay(s).from, { type: "stock" });
  s = botStep(s);
  assert.equal(s.build.flat().length, 1);
});

test("bots build towards their stock card using discards and Skip-Bo cards", () => {
  let s = started(["a", "b"], 6);
  const me = s.players[s.turn];
  me.bot = true;
  me.stock.push(n(4));
  me.hand = [n(1), n(2), W(), n(9), n(11)];
  me.discards = [[], [], [], []];
  for (let i = 0; i < 4; i++) s = botStep(s);
  assert.deepEqual(s.build.find((p) => p.length).map((c) => c.as), [1, 2, 3, 4]);
  assert.equal(s.players.find((p) => p.id === me.id).stock.length, 30);
});

for (const seed of [1, 2, 3, 4, 5, 6]) {
  test(`bots play whole games to a winner (seed ${seed})`, () => {
    const rng = seeded(seed * 7919);
    let s = E.createGame("h", "Host");
    const players = 2 + (seed % 5);
    for (let i = 1; i < players; i++) s = E.addBot(s, "h");
    s = E.setStockSize(s, "h", seed % 2 ? 10 : null);
    s = E.startGame(s, "h", rng);
    s.players[0].bot = true;
    let steps = 0;
    while (s.status === "playing") {
      assert.ok(++steps < 60000, "game should finish");
      s = safeBotStep(s, rng);
      assert.equal(total(s), 162);
      for (const pile of s.build) pile.forEach((c, i) => assert.equal(c.as, i + 1));
    }
    assert.equal(s.status, "finished");
    assert.equal(s.players.find((p) => p.id === s.winners[0]).stock.length, 0);
  });
}

test("a full round of passes ends the game: fewest stock cards wins", () => {
  let s = started(["a", "b", "c"], 12);
  s.drawPile = [];
  s.completed = [];
  for (const p of s.players) p.hand = [];
  s.players[0].stock.splice(0, 5);
  s.players[2].stock.splice(0, 5);
  for (let i = 0; i < 3; i++) s = E.pass(s, s.players[s.turn].id);
  assert.equal(s.status, "finished");
  assert.deepEqual(s.winners.sort(), ["a", "c"]);
});

test("bots finish a pile to reach a low stock card instead of stalling", () => {
  let s = started(["a", "b"], 13);
  const me = s.players[s.turn];
  me.bot = true;
  s.build = s.build.map(() => Array.from({ length: 11 }, (_, i) => ({ ...n(i + 1), as: i + 1 })));
  me.stock.push(n(1));
  me.hand = [];
  me.discards = [[W()], [], [], []];
  s = botStep(s);
  assert.equal(s.build.filter((p) => p.length === 0).length, 1, "the Skip-Bo finished a pile");
  s = botStep(s);
  assert.equal(s.build.filter((p) => p.length === 1).length, 1, "then the stock 1 started it again");
});
