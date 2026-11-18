// Skip-Bo rules engine. Pure functions over a plain JSON game state, shared by
// the browser client, the Netlify function and the artifact build. Every action
// returns a new state or throws a GameError whose message is safe to show players.

export const MAX_PLAYERS = 6;
export const HAND_SIZE = 5;
export const PILES = 4; // building piles in the middle, and discard piles per player
export const TOP = 12; // a building pile is finished at 12
export const STOCK_CHOICES = [10, 20, 30];

export class GameError extends Error {}
const fail = (msg) => {
  throw new GameError(msg);
};

// ---------- cards ----------

// 144 numbered cards (twelve each of 1–12) and 18 Skip-Bo wild cards.
export function buildDeck() {
  const deck = [];
  let id = 0;
  for (let copy = 0; copy < 12; copy++) {
    for (let n = 1; n <= TOP; n++) deck.push({ id: id++, kind: "n", n });
  }
  for (let i = 0; i < 18; i++) deck.push({ id: id++, kind: "wild" });
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

export const cardLabel = (card) => (card.kind === "wild" ? "Skip-Bo" : String(card.n));

// The official stock is 30 cards with up to 4 players and 20 with 5 or 6.
export const officialStock = (players) => (players <= 4 ? 30 : 20);

// Building piles count up (1, 2, 3… 12) or, in backwards games, down (12, 11… 1),
// so the next number a pile needs follows from its length.
export const DIRECTIONS = ["up", "down"];
export const nextFor = (pile, dir = "up") => (dir === "down" ? TOP - pile.length : pile.length + 1);
export const fits = (card, pile, dir = "up") => card.kind === "wild" || card.n === nextFor(pile, dir);
// The number a pile needs after `v`; past the last number a fresh pile starts.
export const stepAfter = (v, dir = "up") => (dir === "down" ? (v === 1 ? TOP : v - 1) : v === TOP ? 1 : v + 1);

// ---------- game flow ----------

export function createGame(hostId, hostName) {
  return {
    v: 1,
    seq: 0,
    status: "lobby",
    host: hostId,
    stockSize: null, // null = official size for the player count
    direction: "up",
    players: [newPlayer(hostId, hostName)],
    turn: 0,
    round: 0,
    drawPile: [],
    build: [[], [], [], []],
    completed: [],
    winners: [],
    moves: [],
    moveNo: 0,
    passes: 0,
    log: [],
  };
}

function newPlayer(id, name) {
  const clean = String(name || "").trim().slice(0, 20);
  if (!clean) fail("Enter a name to join.");
  return { id, name: clean, stock: [], hand: [], discards: [[], [], [], []], wins: 0 };
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

// Keeps a short history of plays so every screen can animate them in order.
function record(s, move) {
  s.moveNo += 1;
  s.moves.push({ m: s.moveNo, ...move });
  if (s.moves.length > 24) s.moves.splice(0, s.moves.length - 24);
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

export function setStockSize(state, byId, size) {
  if (state.status !== "lobby") fail("The stock size is set before the game starts.");
  if (byId !== state.host) fail("Only the host can change the stock size.");
  if (size !== null && !STOCK_CHOICES.includes(size)) fail("Pick a stock size of 10, 20 or 30.");
  const s = clone(state);
  s.stockSize = size;
  return finish(s);
}

export function setDirection(state, byId, dir) {
  if (state.status !== "lobby") fail("The counting direction is set before the game starts.");
  if (byId !== state.host) fail("Only the host can change the counting direction.");
  if (!DIRECTIONS.includes(dir)) fail("Pick counting up or counting down.");
  const s = clone(state);
  s.direction = dir;
  return finish(s);
}

export function startGame(state, byId, rng = Math.random) {
  if (state.status !== "lobby") fail("The game has already started.");
  if (byId !== state.host) fail("Only the host can start the game.");
  if (state.players.length < 2) fail("You need at least 2 players to start.");
  const s = clone(state);
  deal(s, rng);
  return finish(s);
}

function deal(s, rng) {
  const deck = shuffle(buildDeck(), rng);
  const size = s.stockSize || officialStock(s.players.length);
  s.round += 1;
  for (const p of s.players) {
    p.stock = [];
    p.hand = [];
    p.discards = [[], [], [], []];
  }
  // Stock cards are dealt one at a time around the table, as at a real table.
  for (let i = 0; i < size; i++) for (const p of s.players) p.stock.push(deck.pop());
  s.drawPile = deck;
  s.build = [[], [], [], []];
  s.completed = [];
  s.winners = [];
  s.moves = [];
  s.passes = 0;
  s.status = "playing";
  s.turn = Math.floor(rng() * s.players.length);
  const order = s.direction === "down" ? ", counting down from 12" : "";
  log(s, `Round ${s.round}: ${size} stock cards each${order}. ${s.players[s.turn].name} goes first.`);
  refill(s, s.players[s.turn], rng);
}

// Tops the hand up to five. When the draw pile runs out, finished building
// piles are shuffled back in to make a new one.
function refill(s, p, rng) {
  let drawn = 0;
  while (p.hand.length < HAND_SIZE) {
    if (s.drawPile.length === 0) {
      if (s.completed.length === 0) break;
      s.drawPile = shuffle(s.completed, rng);
      s.completed = [];
      log(s, "Finished piles were shuffled into a new draw pile.");
    }
    p.hand.push(s.drawPile.pop());
    drawn++;
  }
  if (drawn) record(s, { player: p.id, draw: drawn });
}

function current(state, playerId) {
  if (state.status !== "playing") fail("The game isn't in progress.");
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx < 0) fail("You're not in this game.");
  if (idx !== state.turn) fail(`It's ${state.players[state.turn].name}'s turn.`);
  return idx;
}

// Where a card comes from: {type: "hand", cardId}, {type: "stock"} or {type: "discard", index}.
function source(p, from) {
  if (!from) fail("Pick a card to play.");
  if (from.type === "stock") {
    if (!p.stock.length) fail("Your stock pile is empty.");
    return { card: p.stock[p.stock.length - 1], take: () => p.stock.pop() };
  }
  if (from.type === "discard") {
    const pile = p.discards[from.index];
    if (!pile) fail("That discard pile doesn't exist.");
    if (!pile.length) fail("That discard pile is empty.");
    return { card: pile[pile.length - 1], take: () => pile.pop() };
  }
  if (from.type === "hand") {
    const i = p.hand.findIndex((c) => c.id === from.cardId);
    if (i < 0) fail("That card isn't in your hand.");
    return { card: p.hand[i], take: () => p.hand.splice(i, 1)[0] };
  }
  fail("Pick a card to play.");
}

export function play(state, playerId, from, buildIndex, rng = Math.random) {
  const idx = current(state, playerId);
  const s = clone(state);
  const p = s.players[idx];
  const src = source(p, from);
  const pile = s.build[buildIndex];
  if (!pile) fail("Pick one of the four building piles.");
  const dir = s.direction || "up";
  const need = nextFor(pile, dir);
  if (!fits(src.card, pile, dir)) {
    fail(pile.length ? `That pile needs a ${need} or a Skip-Bo.` : `A building pile starts with a ${need} or a Skip-Bo.`);
  }
  const card = src.take();
  pile.push({ ...card, as: need });
  const move = { player: p.id, card, from: { type: from.type, index: from.index ?? null }, to: { type: "build", index: buildIndex }, as: need };
  if (pile.length === TOP) {
    s.completed.push(...s.build[buildIndex].map(({ as, ...c }) => c));
    s.build[buildIndex] = [];
    move.completed = true;
    log(s, `${p.name} finished a building pile.`);
  }
  record(s, move);
  s.passes = 0;

  if (from.type === "stock" && p.stock.length === 0) {
    s.status = "finished";
    s.winners = [p.id];
    p.wins += 1;
    log(s, `${p.name} played their last stock card and won!`);
    return finish(s);
  }
  // Playing your whole hand earns five fresh cards straight away.
  if (p.hand.length === 0) refill(s, p, rng);
  return finish(s);
}

export function discard(state, playerId, cardId, pileIndex, rng = Math.random) {
  const idx = current(state, playerId);
  const s = clone(state);
  const p = s.players[idx];
  const i = p.hand.findIndex((c) => c.id === cardId);
  if (i < 0) fail("Discard a card from your hand.");
  const pile = p.discards[pileIndex];
  if (!pile) fail("Pick one of your four discard piles.");
  const [card] = p.hand.splice(i, 1);
  pile.push(card);
  record(s, { player: p.id, card, from: { type: "hand", index: null }, to: { type: "discard", index: pileIndex } });
  s.passes = 0;
  endTurn(s, rng);
  return finish(s);
}

// Only when you have nothing left to discard and nothing to draw.
export function pass(state, playerId, rng = Math.random) {
  const idx = current(state, playerId);
  if (state.players[idx].hand.length) fail("End your turn by discarding a card.");
  const s = clone(state);
  log(s, `${s.players[idx].name} had no cards to discard.`);
  s.passes = (s.passes || 0) + 1;
  // A whole round of passes means nobody can ever move again: the fewest
  // stock cards left wins.
  if (s.passes >= s.players.length) {
    const fewest = Math.min(...s.players.map((p) => p.stock.length));
    s.status = "finished";
    s.winners = s.players.filter((p) => p.stock.length === fewest).map((p) => p.id);
    for (const p of s.players) if (s.winners.includes(p.id)) p.wins += 1;
    log(s, "Nobody can move, so the fewest stock cards left wins.");
    return finish(s);
  }
  endTurn(s, rng);
  return finish(s);
}

function endTurn(s, rng) {
  s.turn = (s.turn + 1) % s.players.length;
  refill(s, s.players[s.turn], rng);
}

export function restart(state, byId, rng = Math.random) {
  if (state.status !== "finished") fail("The game isn't over yet.");
  if (byId !== state.host && !state.players.some((p) => p.id === byId)) fail("You're not in this game.");
  const s = clone(state);
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
    case "stockSize":
      return setStockSize(state, playerId, action.size ?? null);
    case "direction":
      return setDirection(state, playerId, action.dir);
    case "start":
      return startGame(state, playerId, rng);
    case "play":
      return play(state, playerId, action.from, action.build, rng);
    case "discard":
      return discard(state, playerId, action.cardId, action.pile, rng);
    case "pass":
      return pass(state, playerId, rng);
    case "restart":
      return restart(state, playerId, rng);
    default:
      fail("Unknown action.");
  }
}

// What one player is allowed to see: their own hand, everyone's stock top and
// size, every discard pile, and only the size of the draw pile.
export function viewFor(state, playerId) {
  return {
    ...state,
    drawPile: undefined,
    drawCount: state.drawPile.length,
    completed: undefined,
    completedCount: state.completed.length,
    players: state.players.map((p) => ({
      ...p,
      stock: undefined,
      stockCount: p.stock.length,
      stockTop: p.stock[p.stock.length - 1] || null,
      hand: p.id === playerId ? p.hand : undefined,
      handCount: p.hand.length,
    })),
    me: playerId,
  };
}
