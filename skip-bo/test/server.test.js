import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../server/handler.js";
import { createMemoryStore } from "../server/memory-store.js";

function client(opts) {
  const handle = createHandler(createMemoryStore(), opts);
  return async (path, body) => {
    const res = await handle(new Request(`http://x/api/${path}`, body ? { method: "POST", body: JSON.stringify(body) } : {}));
    return { status: res.status, data: await res.json() };
  };
}

test("create, join, start: each player sees only their own hand", async () => {
  const call = client();
  const host = (await call("create", { name: "Ann" })).data;
  const guest = (await call("join", { code: host.code.toLowerCase(), name: "Bo" })).data;
  assert.equal(guest.code, host.code);
  assert.equal((await call("act", { code: host.code, token: guest.token, action: { type: "start" } })).status, 400);
  const view = (await call("act", { code: host.code, token: host.token, action: { type: "start" } })).data.view;
  assert.equal(view.status, "playing");
  assert.equal(view.drawPile, undefined);
  for (const p of view.players) {
    assert.equal(p.stock, undefined, "stock order never leaves the server");
    assert.equal(p.stockCount, 30);
    assert.equal(p.hand === undefined, p.id !== view.me);
  }
  const q = `state?code=${host.code}&token=${guest.token}&seq=${view.seq}`;
  assert.deepEqual((await call(q)).data, { unchanged: true });
});

test("rejects bad tokens, unknown rooms and wrong methods", async () => {
  const call = client();
  const host = (await call("create", { name: "Ann" })).data;
  assert.equal((await call(`state?code=${host.code}&token=nope`)).status, 403);
  assert.equal((await call(`state?code=${host.code}&token=constructor`)).status, 403);
  assert.equal((await call("state?code=ZZZZZ&token=x")).status, 404);
  assert.equal((await call("create", { name: " " })).status, 400);
  assert.equal((await call("state", {})).status, 405);
});

test("simultaneous joins are all kept", async () => {
  const call = client();
  const host = (await call("create", { name: "Ann" })).data;
  const all = await Promise.all(["Bo", "Cy", "Di", "Ed", "Flo"].map((name) => call("join", { code: host.code, name })));
  assert.ok(all.every((r) => r.status === 200));
  const r = await call(`state?code=${host.code}&token=${host.token}&seq=-1`);
  assert.equal(r.data.view.players.length, 6);
});

test("bots move one card per poll until it's a person's turn", async () => {
  const call = client({ botDelayMs: 0 });
  const host = (await call("create", { name: "Ann" })).data;
  await call("act", { code: host.code, token: host.token, action: { type: "addBot" } });
  await call("act", { code: host.code, token: host.token, action: { type: "stockSize", size: 10 } });
  let view = (await call("act", { code: host.code, token: host.token, action: { type: "start" } })).data.view;
  const poll = async () => (await call(`state?code=${host.code}&token=${host.token}&seq=-1`)).data.view;
  let steps = 0;
  while (view.status === "playing" && view.players[view.turn].bot && steps < 200) {
    const before = view.moveNo;
    view = await poll();
    if (view.players[view.turn].bot) assert.ok(view.moveNo - before <= 2, "one play (plus any refill) per poll");
    steps++;
  }
  if (view.status === "playing") {
    assert.equal(view.players[view.turn].id, view.me);
    assert.equal((await poll()).seq, view.seq, "nothing happens on the person's turn");
  }
});
