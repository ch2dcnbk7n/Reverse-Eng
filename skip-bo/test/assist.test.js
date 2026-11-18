import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/engine.js";
import { safeBotStep } from "../public/bot.js";
import { createHandler } from "../server/handler.js";
import { createMemoryStore } from "../server/memory-store.js";
import { retouch } from "../server/assist.js";

function seeded(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}
const total = (s) =>
  s.drawPile.length + s.completed.length + s.build.reduce((t, p) => t + p.length, 0) +
  s.players.reduce((t, p) => t + p.stock.length + p.hand.length + p.discards.reduce((u, d) => u + d.length, 0), 0);

function client() {
  const store = createMemoryStore();
  const handle = createHandler(store, { botDelayMs: 0 });
  const call = async (path, body) => {
    const res = await handle(new Request(`http://x/api/${path}`, body ? { method: "POST", body: JSON.stringify(body) } : {}));
    return { status: res.status, text: await res.clone().text(), data: await res.json() };
  };
  return { call, store };
}

test("a joined friend can't see, detect or use the switch", async () => {
  const { call } = client();
  const z = (await call("create", { name: "Z" })).data;
  const bo = (await call("join", { code: z.code, name: "Bo" })).data;
  const boTexts = [];
  const boPoll = async (seq = -1) => {
    const r = await call(`state?code=${z.code}&token=${bo.token}&seq=${seq}`);
    boTexts.push(r.text);
    return r.data;
  };

  // In the lobby Z sees the switch, Bo doesn't.
  let zv = (await call(`state?code=${z.code}&token=${z.token}&seq=-1`)).data.view;
  assert.deepEqual(zv.tune, { on: false, label: "God" });
  const before = (await boPoll()).view;
  assert.equal(before.tune, undefined);

  // Turning it on changes nothing anyone else can see: not even the version number.
  const on = await call("act", { code: z.code, token: z.token, action: { type: "tune", on: true } });
  assert.equal(on.data.view.tune.on, true);
  assert.equal(on.data.view.seq, before.seq, "no game update is sent out");
  assert.deepEqual(await boPoll(before.seq), { unchanged: true });

  // Bo trying the same action gets the same answer as any made-up action.
  const boTry = await call("act", { code: z.code, token: bo.token, action: { type: "tune", on: true } });
  const madeUp = await call("act", { code: z.code, token: bo.token, action: { type: "whatever" } });
  assert.equal(boTry.status, 400);
  assert.deepEqual(boTry.data, madeUp.data);

  // Play a few turns; nothing Bo ever receives mentions it.
  await call("act", { code: z.code, token: z.token, action: { type: "start" } });
  for (let i = 0; i < 6; i++) {
    const v = (await boPoll()).view;
    const turnToken = v.players[v.turn].id === v.me ? bo.token : z.token;
    const view = (await call(`state?code=${z.code}&token=${turnToken}&seq=-1`)).data.view;
    const me = view.players.find((p) => p.id === view.me);
    await call("act", { code: z.code, token: turnToken, action: { type: "discard", cardId: me.hand[0].id, pile: 0 } });
  }
  const everything = boTexts.join("\n");
  for (const word of ["tune", "God", "god", "assist", "tuned"]) assert.ok(!everything.includes(word), `Bo never receives "${word}"`);
  const log = (await boPoll()).view.log.join(" ");
  assert.ok(!/shuffled/.test(log), "no early reshuffle shows up in the log");
});

test("Z can turn it off at any point, including mid-game and on someone else's turn", async () => {
  const { call, store } = client();
  const z = (await call("create", { name: "Z" })).data;
  const bo = (await call("join", { code: z.code, name: "Bo" })).data;
  await call("act", { code: z.code, token: z.token, action: { type: "tune", on: true } });
  let v = (await call("act", { code: z.code, token: z.token, action: { type: "start" } })).data.view;
  // Off whenever: check both on Z's turn and on Bo's.
  for (let i = 0; i < 4; i++) {
    const off = await call("act", { code: z.code, token: z.token, action: { type: "tune", on: false } });
    assert.equal(off.status, 200);
    assert.equal(off.data.view.tune.on, false);
    const doc = (await store.getWithMetadata(z.code)).data;
    assert.equal(doc.tuned[off.data.view.me], false);
    const back = await call("act", { code: z.code, token: z.token, action: { type: "tune", on: true } });
    assert.equal(back.data.view.tune.on, true);
    v = back.data.view;
    const turnToken = v.players[v.turn].id === v.me ? z.token : bo.token;
    const view = (await call(`state?code=${z.code}&token=${turnToken}&seq=-1`)).data.view;
    const me = view.players.find((p) => p.id === view.me);
    await call("act", { code: z.code, token: turnToken, action: { type: "discard", cardId: me.hand[0].id, pile: 1 } });
  }
  // With it off, Z's draws are left exactly as the engine dealt them.
  await call("act", { code: z.code, token: z.token, action: { type: "tune", on: false } });
  const before = (await store.getWithMetadata(z.code)).data.state;
  const after = retouch(before, structuredClone(before), {});
  assert.deepEqual(after, before);
});

// Plays Z the way a person chasing their stock would.
function greedyStep(s) {
  const z = s.players[s.turn];
  const top = z.stock.at(-1);
  const dir = s.direction;
  const fit = (card) => s.build.findIndex((pile) => E.fits(card, pile, dir));
  if (top && fit(top) >= 0) return E.play(s, z.id, { type: "stock" }, fit(top));
  // Steps a pile still needs after this play before the stock card fits it.
  const gap = (pile) => {
    if (top.kind === "wild") return 0;
    let steps = 0;
    for (let v = E.stepAfter(E.nextFor(pile, dir), dir); v !== top.n && steps < 13; v = E.stepAfter(v, dir)) steps++;
    return steps;
  };
  let best = null;
  for (const card of z.hand) {
    s.build.forEach((pile, i) => {
      if (!E.fits(card, pile, dir)) return;
      const score = gap(pile) + (card.kind === "wild" ? 0.5 : 0);
      if (!best || score < best.score) best = { card, i, score };
    });
  }
  if (best) return E.play(s, z.id, { type: "hand", cardId: best.card.id }, best.i);
  return z.hand.length ? E.discard(s, z.id, z.hand.at(-1).id, 0) : E.pass(s, z.id);
}

test("switched on, Z plays a stock card on nearly every turn; draws and reshuffles look normal", () => {
  const rate = (on, dir = "up") => {
    let turns = 0, scored = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seeded(seed);
      const tuned = on ? { z: true } : {};
      let s = E.setDirection(E.addBot(E.createGame("z", "Z"), "z"), "z", dir);
      s = retouch(s, E.startGame(s, "z", rng), tuned);
      let seen = 0, steps = 0;
      while (s.status === "playing" && seen < 3 && steps++ < 3000) {
        const step = s.players[s.turn].id === "z" ? greedyStep : (x) => safeBotStep(x, rng);
        const zTurn = s.players[s.turn].id === "z";
        const before = s.players[0].stock.length;
        do {
          const prev = s;
          s = retouch(prev, step(prev), tuned);
          assert.equal(total(s), 162);
          assert.ok(s.players.every((p) => p.hand.length <= 5));
        } while (s.status === "playing" && zTurn && s.players[s.turn].id === "z" && steps++ < 3000);
        if (zTurn) {
          turns++;
          seen++;
          if (s.players[0].stock.length < before) scored++;
        }
      }
    }
    return scored / turns;
  };
  for (const dir of ["up", "down"]) {
    const on = rate(true, dir);
    const off = rate(false, dir);
    console.log(`# counting ${dir}: stock card played on ${(on * 100).toFixed(0)}% of Z's turns switched on, ${(off * 100).toFixed(0)}% off`);
    assert.ok(on >= 0.9);
    assert.ok(off < on);
  }
});
