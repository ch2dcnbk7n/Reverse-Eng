import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/engine.js";
import { botTurn, botToMove, findPhase } from "../public/bot.js";

let nextId = 2000;
const n = (num, c = "red") => ({ id: nextId++, kind: "n", n: num, c });
const W = () => ({ id: nextId++, kind: "wild" });
const S = () => ({ id: nextId++, kind: "skip" });
function seeded(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test("findPhase finds phases in a messy hand, saving wilds when it can", () => {
  const hand = [n(4), n(9), n(4, "blue"), n(2), n(9, "green"), W(), n(4, "green"), n(11), S()];
  const p1 = findPhase(1, hand);
  assert.ok(p1);
  assert.ok(E.matchPhase(1, p1), "result is a legal phase 1");
  assert.equal(p1.filter((c) => c.kind === "wild").length, 1);

  const runHand = [n(3), n(4), n(5), n(6), W(), n(8), n(9), n(1)];
  assert.ok(E.matchPhase(4, findPhase(4, runHand)), "run of 7 using the wild for 4 or 7");
  assert.equal(findPhase(4, [n(1), n(2), n(3), n(9), n(10), n(11), n(12)]), null);

  const blue = [1, 3, 5, 7, 9, 11].map((x) => n(x, "blue"));
  assert.ok(E.matchPhase(8, findPhase(8, [...blue, n(2, "red"), W()])));
  assert.ok(E.matchPhase(9, findPhase(9, [n(6), n(6), n(6), W(), W(), n(2), n(2, "blue")])));
});

test("addBot: host only, lobby only, unique names and ids", () => {
  let s = E.createGame("a", "Ann");
  assert.throws(() => E.addBot(E.addPlayer(s, "b", "Bo"), "b"), /Only the host/);
  for (let i = 0; i < 5; i++) s = E.addBot(s, "a");
  assert.equal(new Set(s.players.map((p) => p.id)).size, 6);
  assert.equal(new Set(s.players.map((p) => p.name)).size, 6);
  assert.ok(s.players.slice(1).every((p) => p.bot));
  assert.throws(() => E.addBot(s, "a"), /full/);
  s = E.removePlayer(s, "a", "bot_2");
  assert.equal(E.addBot(s, "a").players.at(-1).id, "bot_2", "freed id is reused");
  s = E.removePlayer(s, "a", "bot_3");
  s = E.addPlayer(s, "b", "Bo");
  s = E.removePlayer(s, "a", "a");
  assert.equal(s.host, "b", "host passes to a person, never a bot");
});

test("a bot lays down, adds to the table and discards in one turn", () => {
  let s = E.createGame("a", "Ann");
  s = E.addBot(s, "a");
  s = E.startGame(s, "a", seeded(3));
  // Put the bot on turn with a ready-made phase 1 plus a card that fits it.
  s.turn = s.players.findIndex((p) => p.bot);
  s.step = "draw";
  const bot = s.players[s.turn];
  bot.hand = [n(5), n(5, "blue"), n(5, "green"), n(8), n(8, "blue"), n(8, "green"), n(5, "yellow"), n(12), n(1)];
  assert.ok(botToMove(s));
  s = botTurn(s, seeded(1));
  const after = s.players.find((p) => p.bot);
  assert.ok(after.laid);
  assert.equal(s.table.length, 2);
  assert.ok(s.table.some((g) => g.n === 5 && g.cards.length === 4), "extra 5 was added to the set");
  assert.equal(s.players[s.turn].bot, undefined, "turn passed back to the person");
});

test("a bot throws its Skip at the leader", () => {
  let s = E.createGame("a", "Ann");
  s = E.addPlayer(s, "b", "Bo");
  s = E.addBot(s, "a");
  s = E.startGame(s, "a", seeded(8));
  s.turn = 2;
  s.step = "draw";
  s.players[1].phase = 6;
  s.players[2].hand = [S(), n(1), n(1, "blue"), n(7), n(7, "blue"), W()];
  s = botTurn(s, seeded(2));
  assert.ok(s.players[1].skipped);
});

for (const seed of [1, 2, 3, 4, 5, 6]) {
  test(`bots play a whole game to the end (seed ${seed})`, () => {
    const rng = seeded(seed * 7919);
    let s = E.createGame("h", "Host");
    const players = 2 + (seed % 4);
    for (let i = 1; i < players; i++) s = E.addBot(s, "h");
    s = E.startGame(s, "h", rng);
    s.players[0].bot = true; // let the bots play the host's seat too
    let turns = 0;
    while (s.status !== "finished") {
      assert.ok(++turns < 20000, "game should finish");
      if (s.status === "between") s = E.nextHand(s, "h", rng);
      else s = botTurn(s, rng);
      const cards = s.deck.length + s.discard.length + s.players.reduce((t, p) => t + p.hand.length, 0) + s.table.reduce((t, g) => t + g.cards.length, 0);
      assert.equal(cards, 108);
    }
    assert.ok(s.winners.length >= 1);
    assert.ok(s.players.some((p) => p.phase > 10));
  });
}
