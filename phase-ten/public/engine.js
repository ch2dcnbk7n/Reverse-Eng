// Phase Ten rules engine. Pure functions over a plain JSON game state, shared by
// the browser client, the Netlify function and the artifact build. Every action
// returns a new state or throws a GameError whose message is safe to show players.

export const COLORS = ["red", "blue", "green", "yellow"];
export const MAX_PLAYERS = 6;
export const HAND_SIZE = 10;

// Each phase is a list of groups the player must lay down together.
export const PHASES = [
  [{ kind: "set", size: 3 }, { kind: "set", size: 3 }],
  [{ kind: "set", size: 3 }, { kind: "run", size: 4 }],
  [{ kind: "set", size: 4 }, { kind: "run", size: 4 }],
  [{ kind: "run", size: 7 }],
  [{ kind: "run", size: 8 }],
  [{ kind: "run", size: 9 }],
  [{ kind: "set", size: 4 }, { kind: "set", size: 4 }],
  [{ kind: "color", size: 7 }],
  [{ kind: "set", size: 5 }, { kind: "set", size: 2 }],
  [{ kind: "set", size: 5 }, { kind: "set", size: 3 }],
];

const GROUP_NAMES = { set: "set", run: "run", color: "cards of one color" };

export function describePhase(phase) {
  const groups = PHASES[phase - 1];
  if (!groups) return "All phases complete";
  return groups
    .map((g) => (g.kind === "color" ? `${g.size} cards of one color` : `${g.kind === "set" ? "Set" : "Run"} of ${g.size}`))
    .join(" + ");
}

export class GameError extends Error {}
const fail = (msg) => {
  throw new GameError(msg);
};

// ---------- cards ----------

export function buildDeck() {
  const deck = [];
  let id = 0;
  for (const c of COLORS) {
    for (let copy = 0; copy < 2; copy++) {
      for (let n = 1; n <= 12; n++) deck.push({ id: id++, kind: "n", n, c });
    }
  }
  for (let i = 0; i < 8; i++) deck.push({ id: id++, kind: "wild" });
  for (let i = 0; i < 4; i++) deck.push({ id: id++, kind: "skip" });
  return deck;
}

export function shuffle(cards, rng = Math.random) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardPoints(card) {
  if (card.kind === "wild") return 25;
  if (card.kind === "skip") return 15;
  return card.n <= 9 ? 5 : 10;
}

export function cardLabel(card) {
  if (card.kind === "wild") return "Wild";
  if (card.kind === "skip") return "Skip";
  return `${card.c} ${card.n}`;
}

// ---------- group validation ----------

// Returns a table group for `cards` laid as `kind` with at least `size` cards,
// or null when the cards don't form one. Every group needs one natural card so
// its number, color or position is fixed.
export function makeGroup(kind, cards, size = 1) {
  if (cards.length < size || cards.some((c) => c.kind === "skip")) return null;
  const naturals = cards.filter((c) => c.kind === "n");
  if (naturals.length === 0) return null;

  if (kind === "set") {
    const n = naturals[0].n;
    if (naturals.some((c) => c.n !== n)) return null;
    return { kind, n, cards: cards.slice() };
  }

  if (kind === "color") {
    const c = naturals[0].c;
    if (naturals.some((x) => x.c !== c)) return null;
    return { kind, c, cards: cards.slice() };
  }

  if (kind === "run") {
    if (cards.length > 12) return null;
    const nums = naturals.map((c) => c.n).sort((a, b) => a - b);
    for (let i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1]) return null;
    const lo = nums[0];
    const hi = nums[nums.length - 1];
    if (hi - lo + 1 > cards.length) return null; // not enough wilds to fill the gaps
    // Spare wilds extend the top end first, then the bottom once 12 is reached.
    let end = lo + cards.length - 1;
    let start = lo;
    if (end > 12) {
      start -= end - 12;
      end = 12;
    }
    const wilds = cards.filter((c) => c.kind === "wild");
    const ordered = [];
    for (let v = start; v <= end; v++) ordered.push(naturals.find((c) => c.n === v) || wilds.pop());
    return { kind, start, end, cards: ordered };
  }
  return null;
}

// Finds a way to split `cards` into the groups a phase requires, or null.
export function matchPhase(phase, cards) {
  const reqs = PHASES[phase - 1];
  if (!reqs) return null;
  const total = reqs.reduce((s, r) => s + r.size, 0);
  if (cards.length !== total) return null;

  const buckets = reqs.map(() => []);
  const place = (i) => {
    if (i === cards.length) {
      const groups = reqs.map((r, k) => makeGroup(r.kind, buckets[k], r.size));
      return groups.every(Boolean) ? groups : null;
    }
    for (let k = 0; k < reqs.length; k++) {
      if (buckets[k].length >= reqs[k].size) continue;
      buckets[k].push(cards[i]);
      const found = place(i + 1);
      if (found) return found;
      buckets[k].pop();
    }
    return null;
  };
  return place(0);
}

// Adds one card to a group already on the table. Returns the updated group or null.
export function extendGroup(group, card) {
  if (card.kind === "skip") return null;
  const wild = card.kind === "wild";
  if (group.kind === "set") {
    return wild || card.n === group.n ? { ...group, cards: [...group.cards, card] } : null;
  }
  if (group.kind === "color") {
    return wild || card.c === group.c ? { ...group, cards: [...group.cards, card] } : null;
  }
  if (group.kind === "run") {
    if ((wild && group.end < 12) || card.n === group.end + 1) {
      return { ...group, end: group.end + 1, cards: [...group.cards, card] };
    }
    if ((wild && group.start > 1) || card.n === group.start - 1) {
      return { ...group, start: group.start - 1, cards: [card, ...group.cards] };
    }
  }
  return null;
}

// ---------- game flow ----------

export function createGame(hostId, hostName) {
  return {
    v: 1,
    seq: 0,
    status: "lobby",
    host: hostId,
    players: [newPlayer(hostId, hostName)],
    dealer: 0,
    turn: 0,
    step: "draw",
    handNo: 0,
    deck: [],
    discard: [],
    table: [],
    lastHand: null,
    lastDraw: null,
    winners: [],
    log: [],
  };
}

function newPlayer(id, name) {
  const clean = String(name || "").trim().slice(0, 20);
  if (!clean) fail("Enter a name to join.");
  return { id, name: clean, phase: 1, score: 0, hand: [], laid: false, skipped: false };
}

const clone = (s) => JSON.parse(JSON.stringify(s));

function log(s, text) {
  s.log.push(text);
  if (s.log.length > 30) s.log.splice(0, s.log.length - 30);
}

function finish(s) {
  s.seq += 1;
  return s;
}

export function addPlayer(state, id, name) {
  if (state.players.some((p) => p.id === id)) return state;
  if (state.status !== "lobby") fail("This game has already started.");
  if (state.players.length >= MAX_PLAYERS) fail(`This game is full (${MAX_PLAYERS} players).`);
  const s = clone(state);
  const p = newPlayer(id, name);
  s.players.push(p);
  log(s, `${p.name} joined.`);
  return finish(s);
}

const BOT_NAMES = ["Robo Rita", "Sprocket", "Gizmo", "Bolt", "Chip", "Widget", "Cog"];

export function addBot(state, byId) {
  if (state.status !== "lobby") fail("Bots can only join before the game starts.");
  if (byId !== state.host) fail("Only the host can add bots.");
  if (state.players.length >= MAX_PLAYERS) fail(`The table is full (${MAX_PLAYERS} players).`);
  const s = clone(state);
  const taken = new Set(s.players.map((p) => p.name));
  const name = BOT_NAMES.find((n) => !taken.has(n)) || `Bot ${s.players.length + 1}`;
  let n = 1;
  while (s.players.some((p) => p.id === `bot_${n}`)) n++;
  s.players.push({ ...newPlayer(`bot_${n}`, name), bot: true });
  log(s, `${name} (bot) sat down.`);
  return finish(s);
}

export function removePlayer(state, byId, id) {
  if (state.status !== "lobby") fail("Players can only leave before the game starts.");
  if (byId !== id && byId !== state.host) fail("Only the host can remove other players.");
  const s = clone(state);
  const p = s.players.find((x) => x.id === id);
  if (!p) return state;
  s.players = s.players.filter((x) => x.id !== id);
  const humans = s.players.filter((x) => !x.bot);
  if (s.host === id && humans.length) s.host = humans[0].id;
  log(s, `${p.name} left.`);
  return finish(s);
}

export function startGame(state, byId, rng = Math.random) {
  if (state.status !== "lobby") fail("The game has already started.");
  if (byId !== state.host) fail("Only the host can start the game.");
  if (state.players.length < 2) fail("You need at least 2 players to start.");
  const s = clone(state);
  s.status = "playing";
  s.dealer = Math.floor(rng() * s.players.length);
  deal(s, rng);
  return finish(s);
}

function deal(s, rng) {
  const deck = shuffle(buildDeck(), rng);
  s.handNo += 1;
  for (const p of s.players) {
    p.hand = deck.splice(0, HAND_SIZE);
    p.laid = false;
    p.skipped = false;
  }
  s.discard = [deck.pop()];
  s.lastDraw = null;
  s.deck = deck;
  s.table = [];
  s.step = "draw";
  log(s, `Hand ${s.handNo}: ${s.players[s.dealer].name} dealt.`);
  // A Skip turned up as the first discard skips the first player.
  if (s.discard[0].kind === "skip") s.players[(s.dealer + 1) % s.players.length].skipped = true;
  s.turn = s.dealer;
  advanceTurn(s);
}

function advanceTurn(s) {
  const n = s.players.length;
  let next = (s.turn + 1) % n;
  // Bounded loop: each pass clears a skip, so at most n steps.
  for (let i = 0; i < n && s.players[next].skipped; i++) {
    s.players[next].skipped = false;
    log(s, `${s.players[next].name} is skipped.`);
    next = (next + 1) % n;
  }
  s.turn = next;
  s.step = "draw";
}

function current(state, playerId, step) {
  if (state.status !== "playing") fail("No hand is in progress.");
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx < 0) fail("You're not in this game.");
  if (idx !== state.turn) fail(`It's ${state.players[state.turn].name}'s turn.`);
  if (step && state.step !== step) {
    fail(step === "draw" ? "You've already drawn this turn." : "Draw a card first.");
  }
  return idx;
}

export function draw(state, playerId, source, rng = Math.random) {
  const idx = current(state, playerId, "draw");
  const s = clone(state);
  const p = s.players[idx];
  if (source === "discard") {
    const top = s.discard[s.discard.length - 1];
    if (!top) fail("The discard pile is empty.");
    if (top.kind === "skip") fail("You can't pick up a Skip.");
    p.hand.push(s.discard.pop());
    s.lastDraw = { player: p.id, source: "discard", card: top };
    log(s, `${p.name} took ${cardLabel(top)} from the discard pile.`);
  } else {
    if (s.deck.length === 0) {
      // Reshuffle everything but the top discard into a new draw pile.
      const top = s.discard.pop();
      s.deck = shuffle(s.discard, rng);
      s.discard = top ? [top] : [];
      if (s.deck.length) log(s, "The discard pile was reshuffled into the deck.");
    }
    if (s.deck.length === 0) fail("There are no cards left to draw. Take the discard instead.");
    p.hand.push(s.deck.pop());
    // A deck card stays secret; everyone only learns where it came from.
    s.lastDraw = { player: p.id, source: "deck", card: null };
    log(s, `${p.name} drew from the deck.`);
  }
  s.step = "play";
  return finish(s);
}

function takeFromHand(p, ids) {
  const cards = ids.map((id) => p.hand.find((c) => c.id === id));
  if (cards.some((c) => !c) || new Set(ids).size !== ids.length) fail("Those cards aren't in your hand.");
  p.hand = p.hand.filter((c) => !ids.includes(c.id));
  return cards;
}

export function layDown(state, playerId, cardIds) {
  const idx = current(state, playerId, "play");
  const s = clone(state);
  const p = s.players[idx];
  if (p.laid) fail("You've already laid down your phase this hand.");
  const cards = takeFromHand(p, cardIds);
  const groups = matchPhase(p.phase, cards);
  if (!groups) fail(`Those cards don't make Phase ${p.phase}: ${describePhase(p.phase)}.`);
  for (const g of groups) s.table.push({ ...g, owner: p.id });
  p.laid = true;
  log(s, `${p.name} completed Phase ${p.phase}!`);
  if (p.hand.length === 0) endHand(s, idx);
  return finish(s);
}

export function hit(state, playerId, cardId, groupIndex) {
  const idx = current(state, playerId, "play");
  const s = clone(state);
  const p = s.players[idx];
  if (!p.laid) fail("Lay down your own phase before adding to groups on the table.");
  const group = s.table[groupIndex];
  if (!group) fail("That group isn't on the table.");
  const [card] = takeFromHand(p, [cardId]);
  const next = extendGroup(group, card);
  if (!next) fail(`${cardLabel(card)} doesn't fit that ${GROUP_NAMES[group.kind]}.`);
  s.table[groupIndex] = next;
  const owner = s.players.find((x) => x.id === group.owner);
  log(s, `${p.name} played ${cardLabel(card)} on ${owner ? owner.name : "a"}'s ${GROUP_NAMES[group.kind]}.`);
  if (p.hand.length === 0) endHand(s, idx);
  return finish(s);
}

export function discard(state, playerId, cardId, skipTargetId) {
  const idx = current(state, playerId, "play");
  const s = clone(state);
  const p = s.players[idx];
  const [card] = takeFromHand(p, [cardId]);
  s.discard.push(card);
  if (card.kind === "skip") {
    const others = s.players.filter((x) => x.id !== p.id);
    if (others.every((x) => x.skipped)) {
      log(s, `${p.name} discarded a Skip, but everyone is already skipped.`);
    } else {
      const targetId = others.length === 1 ? others[0].id : skipTargetId;
      const target = others.find((x) => x.id === targetId);
      if (!target) fail("Choose who to skip.");
      if (target.skipped) fail(`${target.name} is already being skipped. Choose someone else.`);
      target.skipped = true;
      log(s, `${p.name} discarded a Skip on ${target.name}.`);
    }
  } else {
    log(s, `${p.name} discarded ${cardLabel(card)}.`);
  }
  if (p.hand.length === 0) endHand(s, idx);
  else advanceTurn(s);
  return finish(s);
}

function endHand(s, winnerIdx) {
  const winner = s.players[winnerIdx];
  const results = s.players.map((p) => {
    const points = p.hand.reduce((sum, c) => sum + cardPoints(c), 0);
    return { id: p.id, completed: p.laid ? p.phase : null, points };
  });
  for (const p of s.players) {
    p.score += p.hand.reduce((sum, c) => sum + cardPoints(c), 0);
    if (p.laid) p.phase += 1;
  }
  s.lastHand = { handNo: s.handNo, wentOut: winner.id, results };
  log(s, `${winner.name} went out and ended hand ${s.handNo}.`);

  const done = s.players.filter((p) => p.phase > PHASES.length);
  if (done.length) {
    const best = Math.min(...done.map((p) => p.score));
    s.winners = done.filter((p) => p.score === best).map((p) => p.id);
    s.status = "finished";
    log(s, `${s.winners.map((id) => s.players.find((p) => p.id === id).name).join(" and ")} won the game!`);
  } else {
    s.status = "between";
  }
}

export function nextHand(state, playerId, rng = Math.random) {
  if (state.status !== "between") fail("The current hand isn't over yet.");
  if (!state.players.some((p) => p.id === playerId)) fail("You're not in this game.");
  const s = clone(state);
  s.status = "playing";
  s.dealer = (s.dealer + 1) % s.players.length;
  deal(s, rng);
  return finish(s);
}

// Applies an action object, the shape every client sends.
export function applyAction(state, playerId, action, rng = Math.random) {
  switch (action && action.type) {
    case "join":
      return addPlayer(state, playerId, action.name);
    case "leave":
      return removePlayer(state, playerId, action.playerId || playerId);
    case "addBot":
      return addBot(state, playerId);
    case "start":
      return startGame(state, playerId, rng);
    case "draw":
      return draw(state, playerId, action.source, rng);
    case "layDown":
      return layDown(state, playerId, action.cardIds || []);
    case "hit":
      return hit(state, playerId, action.cardId, action.groupIndex);
    case "discard":
      return discard(state, playerId, action.cardId, action.skipTarget);
    case "nextHand":
      return nextHand(state, playerId, rng);
    default:
      fail("Unknown action.");
  }
}

// What one player is allowed to see: their own hand, everyone's hand size,
// the top discard, and the deck size.
export function viewFor(state, playerId) {
  return {
    ...state,
    deck: undefined,
    deckCount: state.deck.length,
    discard: state.discard.slice(-1),
    discardCount: state.discard.length,
    players: state.players.map((p) => ({
      ...p,
      hand: p.id === playerId ? p.hand : undefined,
      handCount: p.hand.length,
    })),
    me: playerId,
  };
}
