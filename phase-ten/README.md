# Phase Ten

A multiplayer Phase Ten card game for 2–6 players. It comes in two versions that share one rules engine and one UI:

- **Website** (`public/` + `netlify/functions/api.mjs`). Hosted on Netlify. The server deals the cards and validates every move, and each player only ever receives their own hand. Friends join with a room code or an invite link.
- **Claude artifact** (`dist/phase-ten-artifact.html`). A single page that keeps games in the artifact's shared store. Friends open the shared artifact and join from "Open tables".

## Bots

The host can tap **Add a bot** in the lobby, or anyone can start **Practice against 2 bots** from the home screen. Bots play through the same rule checks as people. On the website the server plays a bot's turn when someone polls and the bot has waited about a second; in the artifact, every player's browser offers to play it and a short lock lets only one do so.

## Layout

| Path | What it is |
|---|---|
| `public/engine.js` | Rules engine: deck, phases, sets/runs/color groups, wilds, skips, scoring, turn flow |
| `public/bot.js` | Computer players: finds phases, adds to the table, picks discards, aims Skips at the leader |
| `public/ui.js` | Table UI, shared by both versions |
| `public/web.js` | Website transport (HTTP + polling) |
| `server/handler.js` | API: create, join, state, act. Uses conditional writes so simultaneous moves never overwrite each other |
| `netlify/functions/api.mjs` | Netlify function wiring the handler to Netlify Blobs |
| `artifact/transport.js` | Artifact transport (shared store + document leases) |
| `scripts/build-artifact.mjs` | Inlines engine, UI and styles into one artifact page |
| `scripts/dev-server.mjs` | Local preview with an in-memory store |

## Commands

```sh
npm install
npm test                    # rules + API tests
node scripts/dev-server.mjs # http://localhost:8888
npm run build:artifact      # writes dist/phase-ten-artifact.html
```

## Live site

https://phase-ten-friends.netlify.app/ (Netlify project `phase-ten-friends`). It was deployed by upload, so pushing to GitHub does not redeploy it; deploy again with the Netlify CLI or connect the repo as below.

## Deploy to Netlify

1. Push this repo to GitHub.
2. In Netlify: **Add new project → Import an existing project**, pick the repo, and set the **base directory** to `phase-ten`. The build settings come from `netlify.toml`.
3. Share the site URL. Rooms expire 3 days after their last move.

## Playing

- Tap cards to select them. Drag a card sideways to move it; your order is saved on that device for the hand, under the **Mine** sort.
- Each player's card shows their current phase (short names on phones), with a check once it's laid down.
- The note under the turn banner says whether the latest player drew from the deck or took the face-up discard, and which card.

## Rules implemented

- 108 cards: numbers 1–12 in four colors (two of each), 8 Wilds, 4 Skips. 10 cards each.
- Phases: 2 sets of 3 · set of 3 + run of 4 · set of 4 + run of 4 · run of 7 · run of 8 · run of 9 · 2 sets of 4 · 7 of one color · set of 5 + set of 2 · set of 5 + set of 3.
- Draw from the deck or discard pile (a Skip can't be picked up), lay down your whole phase at once, then add to any group on the table, and discard.
- Every group needs at least one natural card. Wilds in runs fill gaps; spare wilds extend the top end first.
- A Skip discard makes the chosen player miss their next turn (with two players, the opponent). A Skip turned up as the first discard skips the first player.
- The hand ends when a player runs out of cards. Cards left in hand score 5 (1–9), 10 (10–12), 15 (Skip) or 25 (Wild).
- The game ends after a hand in which someone completes Phase 10. The lowest score among those players wins.
