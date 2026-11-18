# Skip-Bo

A multiplayer Skip-Bo card game for 2–6 players, built like the Phase Ten game in this repo: one rules engine and one UI, shared by two versions.

- **Website** (`public/` + `netlify/functions/api.mjs`). Hosted on Netlify. The server shuffles, deals and checks every move; each player only receives their own hand and the top card of each stock pile. Friends join with a room code or an invite link, no account needed.
- **Claude artifact** (`dist/skip-bo-artifact.html`). A single page that keeps games in the artifact's shared store. Players need a claude.ai account.

## Playing

- Tap a card (your hand, the top of your stock, or the top of a discard pile), then tap where it goes. Or drag it there.
- Building piles that can take the selected card glow. With a hand card selected, your discard piles glow too: dropping it there ends your turn.
- Every play flies across the table for everyone; a finished pile gets a celebration.
- The host picks in the lobby whether the building piles count up (1→12) or down (12→1, a backwards game), and the stock size: official (30 cards, or 20 with 5–6 players), 20, or a quick 10.
- **Practice against 2 bots** starts a game straight away. Bots play one card at a time so you can follow them.

## Rules implemented

- 162 cards: twelve each of 1–12 and 18 Skip-Bo wild cards.
- Four shared building piles run 1 to 12 (or 12 down to 1 in a backwards game). A Skip-Bo card stands in for the number needed. A finished pile is cleared; its cards are shuffled into a new draw pile when the old one runs out.
- Your turn starts with your hand topped up to five. Play from your hand, your stock top, or your discard tops. Play all five and you draw five more.
- End your turn by putting a hand card on one of your four discard piles. Stock cards can't go on discard piles.
- First to play their last stock card wins. If a whole round passes with nobody able to move at all, the fewest stock cards left wins.

## Commands

```sh
npm install
npm test                    # rules, bots and API tests
node scripts/dev-server.mjs # http://localhost:8888
npm run build:artifact      # writes dist/skip-bo-artifact.html
```

## Layout

| Path | What it is |
|---|---|
| `public/engine.js` | Rules engine |
| `public/bot.js` | Computer players: chase their stock card, finish piles, avoid setting up the next player |
| `public/ui.js`, `public/styles.css` | Table UI, shared by both versions |
| `public/web.js` | Website transport (HTTP + polling, faster while a bot moves) |
| `server/handler.js` | API: create, join, state, act, with conditional writes |
| `netlify/functions/api.mjs` | Netlify function wiring the handler to Netlify Blobs |
| `artifact/transport.js` | Artifact transport (shared store + document leases) |
| `scripts/build-artifact.mjs` | Inlines engine, bots, UI and styles into one artifact page |
