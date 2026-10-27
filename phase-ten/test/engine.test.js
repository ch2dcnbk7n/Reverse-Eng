import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/engine.js";

let nextId = 1000;
const n = (num, c = "red") => ({ id: nextId++, kind: "n", n: num, c });
const W = () => ({ id: nextId++, kind: "wild" });
const S = () => ({ id: nextId++, kind: "skip" });

// Deterministic RNG so deals are repeatable.
function seeded(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test("deck has 108 cards: 96 numbered, 8 wilds, 4 skips", () => {
  const d = E.buildDeck();
  assert.equal(d.length, 108);
  assert.equal(d.filter((c) => c.kind === "wild").length, 8);
  assert.equal(d.filter((c) => c.kind === "skip").length, 4);
  assert.equal(new Set(d.map((c) => c.id)).size, 108);
  for (const color of E.COLORS) assert.equal(d.filter((c) => c.c === color).length, 24);
});

test("card points follow the scoring table", () => {
  assert.equal(E.cardPoints(n(1)), 5);
  assert.equal(E.cardPoints(n(9)), 5);
  assert.equal(E.cardPoints(n(10)), 10);
  assert.equal(E.cardPoints(n(12)), 10);
  assert.equal(E.cardPoints(S()), 15);
  assert.equal(E.cardPoints(W()), 25);
});

test("sets", () => {
  assert.ok(E.makeGroup("set", [n(7), n(7, "blue"), n(7, "green")], 3));
  assert.ok(E.makeGroup("set", [n(7), W(), W()], 3));
  assert.equal(E.makeGroup("set", [n(7), n(8), n(7)], 3), null);
  assert.equal(E.makeGroup("set", [W(), W(), W()], 3), null, "needs a natural card");
  assert.equal(E.makeGroup("set", [n(7), n(7), S()], 3), null, "skips never play");
  assert.equal(E.makeGroup("set", [n(7), n(7)], 3), null, "too small");
});

test("runs, including wilds filling gaps and extending past 12", () => {
  const r = E.makeGroup("run", [n(3), n(5), W(), n(6)], 4);
  assert.deepEqual([r.start, r.end], [3, 6]);
  assert.deepEqual(r.cards.map((c) => c.n ?? "W"), [3, "W", 5, 6]);

  const top = E.makeGroup("run", [n(11), n(12), W(), W()], 4);
  assert.deepEqual([top.start, top.end], [9, 12]);
  assert.deepEqual(top.cards.map((c) => c.n ?? "W"), ["W", "W", 11, 12]);

  assert.equal(E.makeGroup("run", [n(3), n(3), n(4), n(5)], 4), null, "duplicates");
  assert.equal(E.makeGroup("run", [n(1), n(2), n(3), n(9)], 4), null, "gap too wide");
  assert.ok(E.makeGroup("run", [n(1, "blue"), n(2, "red"), n(3, "green"), n(4, "yellow")], 4), "colors don't matter");
});

test("color groups", () => {
  const blue = [1, 3, 5, 8, 9, 11].map((x) => n(x, "blue"));
  assert.ok(E.makeGroup("color", [...blue, W()], 7));
  assert.equal(E.makeGroup("color", [...blue, n(2, "red")], 7), null);
});

test("matchPhase finds a split regardless of selection order", () => {
  // Phase 2: set of 3 + run of 4, shuffled together.
  const cards = [n(5), n(9), n(6), n(9, "blue"), n(7), W(), n(8)];
  const groups = E.matchPhase(2, cards);
  assert.ok(groups);
  assert.equal(groups[0].kind, "set");
  assert.equal(groups[1].kind, "run");
  assert.equal(E.matchPhase(2, cards.slice(0, 6)), null, "wrong card count");

  assert.ok(E.matchPhase(9, [n(4), n(4), n(4), n(4), W(), n(2), n(2)]));
  assert.equal(E.matchPhase(1, [n(4), n(4), n(4), n(5), n(6), n(7)]), null);
});

test("hitting extends sets, runs at either end, and color groups", () => {
  const set = E.makeGroup("set", [n(7), n(7), n(7)], 3);
  assert.equal(E.extendGroup(set, n(7, "blue")).cards.length, 4);
  assert.equal(E.extendGroup(set, n(8)), null);

  const run = E.makeGroup("run", [n(5), n(6), n(7), n(8)], 4);
  assert.equal(E.extendGroup(run, n(9)).end, 9);
  assert.equal(E.extendGroup(run, n(4)).start, 4);
  assert.equal(E.extendGroup(run, n(10)), null);
  assert.equal(E.extendGroup(run, W()).end, 9);

  const high = E.makeGroup("run", [n(9), n(10), n(11), n(12)], 4);
  assert.equal(E.extendGroup(high, W()).start, 8, "wild goes low once the run reaches 12");
  const full = { kind: "run", start: 1, end: 12, cards: [] };
  assert.equal(E.extendGroup(full, W()), null);

  const color = E.makeGroup("color", [1, 2, 3, 4, 5, 6, 7].map((x) => n(x, "green")), 7);
  assert.ok(E.extendGroup(color, n(12, "green")));
  assert.equal(E.extendGroup(color, n(12, "red")), null);
  assert.equal(E.extendGroup(set, S()), null);
});

function startedGame(players = ["a", "b", "c"], seed = 7) {
  let s = E.createGame(players[0], players[0].toUpperCase());
  for (const id of players.slice(1)) s = E.addPlayer(s, id, id.toUpperCase());
  return E.startGame(s, players[0], seeded(seed));
}

test("lobby rules", () => {
  let s = E.createGame("a", "Ann");
  assert.throws(() => E.startGame(s, "a"), /at least 2/);
  s = E.addPlayer(s, "b", "Bo");
  assert.throws(() => E.startGame(s, "b"), /Only the host/);
  assert.equal(E.addPlayer(s, "b", "Bo"), s, "rejoining is a no-op");
  assert.throws(() => E.addPlayer(s, "c", "   "), /Enter a name/);
  for (const id of ["c", "d", "e", "f"]) s = E.addPlayer(s, id, id);
  assert.throws(() => E.addPlayer(s, "g", "g"), /full/);
  s = E.removePlayer(s, "a", "a");
  assert.equal(s.host, "b", "host passes to the next player");
});

test("dealing gives 10 cards each and keeps all 108 cards", () => {
  const s = startedGame();
  assert.equal(s.status, "playing");
  for (const p of s.players) assert.equal(p.hand.length, 10);
  const total = s.deck.length + s.discard.length + s.players.reduce((t, p) => t + p.hand.length, 0);
  assert.equal(total, 108);
  assert.equal(s.step, "draw");
});

test("turn order, drawing and discarding", () => {
  let s = startedGame(["a", "b", "c"], 3);
  const first = s.players[s.turn];
  const other = s.players.find((p) => p.id !== first.id);
  assert.throws(() => E.draw(s, other.id, "deck"), /turn/);
  assert.throws(() => E.discard(s, first.id, first.hand[0].id), /Draw a card first/);

  s = E.draw(s, first.id, "deck");
  assert.equal(s.players[s.turn].hand.length, 11);
  assert.throws(() => E.draw(s, first.id, "deck"), /already drawn/);

  const me = s.players[s.turn];
  const card = me.hand.find((c) => c.kind !== "skip");
  const before = s.turn;
  s = E.discard(s, me.id, card.id);
  assert.equal(s.discard.at(-1).id, card.id);
  assert.notEqual(s.turn, before);
  assert.equal(s.step, "draw");
});

test("cannot pick a Skip up from the discard pile", () => {
  const s = startedGame();
  s.discard.push(S());
  assert.throws(() => E.draw(s, s.players[s.turn].id, "discard"), /Skip/);
});

test("discarding a Skip skips the chosen player", () => {
  let s = startedGame(["a", "b", "c"], 11);
  const me = s.players[s.turn];
  me.hand.push(S());
  s = E.draw(s, me.id, "deck");
  const skipCard = s.players[s.turn].hand.find((c) => c.kind === "skip");
  const order = s.players.map((p) => p.id);
  const nextId = order[(s.turn + 1) % 3];
  const afterId = order[(s.turn + 2) % 3];
  assert.throws(() => E.discard(s, me.id, skipCard.id), /Choose who to skip/);
  s = E.discard(s, me.id, skipCard.id, nextId);
  assert.equal(s.players[s.turn].id, afterId);
});

test("two players: a Skip gives the same player another turn", () => {
  let s = startedGame(["a", "b"], 5);
  const me = s.players[s.turn];
  me.hand.push(S());
  s = E.draw(s, me.id, "deck");
  const skipCard = s.players[s.turn].hand.find((c) => c.kind === "skip");
  s = E.discard(s, me.id, skipCard.id);
  assert.equal(s.players[s.turn].id, me.id);
});

test("laying down, hitting, going out and scoring", () => {
  let s = startedGame(["a", "b"], 9);
  const idx = s.turn;
  const me = s.players[idx];
  const opp = s.players[1 - idx];
  // Rig the hands: phase 1 (two sets of 3) plus two extra cards.
  me.hand = [n(4), n(4), n(4), n(9), n(9), W(), n(4, "blue"), n(2)];
  opp.hand = [n(1), n(11), W(), S()]; // 5 + 10 + 25 + 15 = 55

  s = E.draw(s, me.id, "deck");
  const drawn = s.players[idx].hand.at(-1);
  assert.throws(() => E.hit(s, me.id, drawn.id, 0), /Lay down your own phase/);
  const [a, b, c, d, e, f] = s.players[idx].hand.slice(0, 6).map((x) => x.id);
  assert.throws(() => E.layDown(s, me.id, [a, b, c, d, e]), /Phase 1/);
  s = E.layDown(s, me.id, [a, b, c, d, e, f]);
  assert.equal(s.table.length, 2);
  assert.throws(() => E.layDown(s, me.id, []), /already laid/);

  const blue4 = s.players[idx].hand.find((x) => x.n === 4);
  const setIdx = s.table.findIndex((g) => g.n === 4);
  s = E.hit(s, me.id, blue4.id, setIdx);
  assert.equal(s.table[setIdx].cards.length, 4);
  const two = s.players[idx].hand.find((x) => x.n === 2);
  assert.throws(() => E.hit(s, me.id, two.id, setIdx), /doesn't fit/);

  // Discard the 2, then hit or discard the drawn card to go out.
  s = E.discard(s, me.id, two.id);
  assert.equal(s.status, "playing");
  // Opponent's turn: rig so they just discard.
  s = E.draw(s, opp.id, "deck");
  const oppDrawn = s.players[1 - idx].hand.at(-1);
  s = E.discard(s, opp.id, oppDrawn.id);

  s = E.draw(s, me.id, "deck");
  const mine = s.players[idx].hand;
  s = E.discard(s, me.id, mine[0].id);
  s = E.draw(s, opp.id, "deck");
  s = E.discard(s, opp.id, s.players[1 - idx].hand.at(-1).id);
  s = E.draw(s, me.id, "deck");
  // Force going out: leave a single non-skip card and discard it.
  s.players[idx].hand = [n(6)];
  s = E.discard(s, me.id, s.players[idx].hand[0].id);

  assert.equal(s.status, "between");
  assert.equal(s.players[idx].phase, 2, "completed phase advances");
  assert.equal(s.players[1 - idx].phase, 1);
  assert.equal(s.players[idx].score, 0);
  assert.equal(s.players[1 - idx].score, 55);
  assert.equal(s.lastHand.wentOut, me.id);

  const dealer = s.dealer;
  s = E.nextHand(s, opp.id, seeded(2));
  assert.equal(s.status, "playing");
  assert.equal(s.dealer, (dealer + 1) % 2);
  assert.equal(s.table.length, 0);
  for (const p of s.players) assert.equal(p.hand.length, 10);
});

test("completing phase 10 ends the game; lowest score among finishers wins", () => {
  let s = startedGame(["a", "b"], 4);
  const idx = s.turn;
  const me = s.players[idx];
  me.phase = 10;
  me.score = 120;
  s.players[1 - idx].score = 40;
  me.hand = [n(8), n(8), n(8), n(8), n(8, "blue"), n(3), n(3), n(3), n(1)];
  s = E.draw(s, me.id, "deck");
  const ids = me.hand.slice(0, 8).map((c) => c.id);
  s = E.layDown(s, me.id, ids);
  s.players[idx].hand = [n(1)];
  s = E.discard(s, me.id, s.players[idx].hand[0].id);
  assert.equal(s.status, "finished");
  assert.deepEqual(s.winners, [me.id]);
  assert.throws(() => E.nextHand(s, me.id), /isn't over/);
});

test("empty deck reshuffles the discard pile, keeping the top card", () => {
  let s = startedGame();
  const p = s.players[s.turn];
  s.discard = [...s.deck.slice(0, 5), n(3)];
  s.deck = [];
  const top = s.discard.at(-1);
  s = E.draw(s, p.id, "deck");
  assert.deepEqual(s.discard, [top]);
  assert.equal(s.deck.length, 4);
});

test("viewFor hides other hands and the deck", () => {
  const s = startedGame();
  const v = E.viewFor(s, "b");
  assert.equal(v.deck, undefined);
  assert.equal(v.deckCount, s.deck.length);
  assert.equal(v.discard.length, 1);
  for (const p of v.players) {
    assert.equal(p.handCount, 10);
    assert.equal(p.hand === undefined, p.id !== "b");
  }
  assert.equal(JSON.stringify(v).includes(JSON.stringify(s.players[0].hand[0])), false);
});

test("applyAction dispatches and rejects unknown actions", () => {
  let s = E.createGame("a", "A");
  s = E.applyAction(s, "b", { type: "join", name: "B" });
  assert.equal(s.players.length, 2);
  assert.throws(() => E.applyAction(s, "a", { type: "cheat" }), E.GameError);
  const seq = s.seq;
  s = E.applyAction(s, "a", { type: "start" });
  assert.equal(s.seq, seq + 1);
});

test("random play keeps all 108 cards and never breaks turn order", () => {
  const rng = seeded(42);
  let s = startedGame(["a", "b", "c", "d"], 42);
  for (let turn = 0; turn < 400 && s.status === "playing"; turn++) {
    const me = s.players[s.turn];
    const top = s.discard.at(-1);
    s = E.draw(s, me.id, top && top.kind !== "skip" && rng() < 0.3 ? "discard" : "deck", rng);
    const hand = s.players[s.turn].hand;
    const card = hand[Math.floor(rng() * hand.length)];
    const others = s.players.filter((p) => p.id !== me.id && !p.skipped);
    if (card.kind === "skip" && others.length === 0) continue;
    s = E.discard(s, me.id, card.id, others[0] && others[0].id);
    const total = s.deck.length + s.discard.length + s.players.reduce((t, p) => t + p.hand.length, 0);
    assert.equal(total, 108);
    assert.equal(s.step, "draw");
  }
});

test("lastDraw says where each draw came from, never which deck card", () => {
  let s = startedGame(["a", "b"], 21);
  assert.equal(s.lastDraw, null);
  const first = s.players[s.turn];
  s = E.draw(s, first.id, "deck");
  assert.deepEqual(s.lastDraw, { player: first.id, source: "deck", card: null });
  const card = s.players[s.turn].hand.find((c) => c.kind !== "skip");
  s = E.discard(s, first.id, card.id);
  const second = s.players[s.turn];
  s = E.draw(s, second.id, "discard");
  assert.equal(s.lastDraw.player, second.id);
  assert.equal(s.lastDraw.source, "discard");
  assert.equal(s.lastDraw.card.id, card.id);
  assert.equal(E.viewFor(s, first.id).lastDraw.card.id, card.id, "everyone sees the taken card");
  s.status = "between";
  s = E.nextHand(s, first.id);
  assert.equal(s.lastDraw, null, "cleared for a new hand");
});
