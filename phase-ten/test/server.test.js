import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../server/handler.js";
import { createMemoryStore } from "../server/memory-store.js";

function client(opts) {
  const handle = createHandler(createMemoryStore(), opts);
  const call = async (path, body) => {
    const res = await handle(
      new Request(`http://x/api/${path}`, body ? { method: "POST", body: JSON.stringify(body) } : {})
    );
    return { status: res.status, data: await res.json() };
  };
  return call;
}

test("create, join, start and play through the API", async () => {
  const call = client();
  const host = (await call("create", { name: "Ann" })).data;
  assert.match(host.code, /^[A-Z]{5}$/);
  const guest = (await call("join", { code: host.code.toLowerCase(), name: "Bo" })).data;
  assert.equal(guest.code, host.code);

  let r = await call("act", { code: host.code, token: guest.token, action: { type: "start" } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Only the host/);

  r = await call("act", { code: host.code, token: host.token, action: { type: "start" } });
  assert.equal(r.status, 200);
  const view = r.data.view;
  assert.equal(view.status, "playing");
  assert.equal(view.deck, undefined, "deck order never leaves the server");
  const others = view.players.filter((p) => p.id !== view.me);
  assert.ok(others.every((p) => p.hand === undefined && p.handCount === 10));

  const q = (tok, seq) => `state?code=${host.code}&token=${tok}&seq=${seq}`;
  r = await call(q(guest.token, view.seq));
  assert.deepEqual(r.data, { unchanged: true });
  r = await call(q(guest.token, -1));
  assert.equal(r.data.view.players.find((p) => p.id === r.data.view.me).hand.length, 10);

  const turnTok = view.players[view.turn].id === view.me ? host.token : guest.token;
  r = await call("act", { code: host.code, token: turnTok, action: { type: "draw", source: "deck" } });
  assert.equal(r.data.view.step, "play");
});

test("rejects bad tokens, unknown rooms and wrong methods", async () => {
  const call = client();
  const host = (await call("create", { name: "Ann" })).data;
  assert.equal((await call(`state?code=${host.code}&token=nope`)).status, 403);
  assert.equal((await call(`state?code=${host.code}&token=constructor`)).status, 403);
  assert.equal((await call("state?code=ZZZZZ&token=x")).status, 404);
  assert.equal((await call("join", { code: "ZZZZZ", name: "Bo" })).status, 404);
  assert.equal((await call("create", { name: "  " })).status, 400);
  assert.equal((await call("state", {})).status, 405);
  assert.equal((await call("nope", {})).status, 404);
});

test("simultaneous joins are all kept", async () => {
  const call = client();
  const host = (await call("create", { name: "Ann" })).data;
  const names = ["Bo", "Cy", "Di", "Ed", "Flo"];
  const results = await Promise.all(names.map((name) => call("join", { code: host.code, name })));
  assert.ok(results.every((r) => r.status === 200));
  const r = await call(`state?code=${host.code}&token=${host.token}&seq=-1`);
  assert.equal(r.data.view.players.length, 6);
});

test("bots take their turns when players poll", async () => {
  const call = client({ botDelayMs: 0 });
  const host = (await call("create", { name: "Ann" })).data;
  await call("act", { code: host.code, token: host.token, action: { type: "addBot" } });
  await call("act", { code: host.code, token: host.token, action: { type: "addBot" } });
  let view = (await call("act", { code: host.code, token: host.token, action: { type: "start" } })).data.view;
  assert.equal(view.players.filter((p) => p.bot).length, 2);
  const poll = async () => (await call(`state?code=${host.code}&token=${host.token}&seq=-1`)).data.view;
  // Poll until it's the person's turn; bots move one turn per poll.
  for (let i = 0; i < 30 && view.players[view.turn].bot; i++) view = await poll();
  assert.equal(view.players[view.turn].id, view.me);
  assert.equal(view.step, "draw");
  // On the person's turn polling changes nothing.
  const seq = view.seq;
  const again = await poll();
  assert.equal(again.seq, seq, JSON.stringify(again.log.slice(-4)) + " turn " + again.players[again.turn].name);

  view = (await call("act", { code: host.code, token: host.token, action: { type: "draw", source: "deck" } })).data.view;
  const me = view.players.find((p) => p.id === view.me);
  const card = me.hand.find((c) => c.kind !== "skip");
  view = (await call("act", { code: host.code, token: host.token, action: { type: "discard", cardId: card.id } })).data.view;
  if (view.status === "playing" && view.players[view.turn].bot) {
    const after = await poll();
    assert.ok(after.seq > view.seq, "the bot moved");
    assert.ok(after.status !== "playing" || after.step === "draw", "and finished its whole turn");
  }
});

test("bots wait for the delay before moving", async () => {
  const call = client({ botDelayMs: 60000 });
  const host = (await call("create", { name: "Ann" })).data;
  await call("act", { code: host.code, token: host.token, action: { type: "addBot" } });
  let view = (await call("act", { code: host.code, token: host.token, action: { type: "start" } })).data.view;
  const r = await call(`state?code=${host.code}&token=${host.token}&seq=${view.seq}`);
  assert.deepEqual(r.data, { unchanged: true });
});
