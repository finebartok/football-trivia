# Deploying

The game is a static site plus a Supabase project. Nothing needs a build
step: the browser loads the same files the repository holds.

## Where it runs now

The live game is **https://football-trivia-xi.vercel.app/**. Vercel runs
`npm run publish` and serves `dist/` (see `vercel.json`). Once the Vercel
project is connected to `finebartok/football-trivia` on GitHub, every push
to `main` deploys.

Netlify also holds a working copy, but `*.netlify.app` is unreachable from
this network, so it is not the primary host.

## What goes where

| Piece | Where it goes |
|---|---|
| `client/` contents | the web root, via `npm run publish` |
| `js/engine/`, `js/presets.js`, `lib/` | the web root — the client imports them by absolute path |
| `data/fixtures/pool.sample.json` | generated into the web root — the lean full pool for hand-built vibes |
| `data/pools/*.json` | generated into the web root — one small pool per preset, plus `meta.json` |
| `client/fonts/` | the web root — the fonts are ours, not a third party's |
| `supabase/migrations/` | the Supabase database |
| `supabase/functions/` | the Supabase edge functions |

**The web root is `dist/`**, not the repository root. `npm run publish`
copies the game files there, and the client's absolute paths
(`/src/main.js`, `/js/engine/index.js`, `/lib/scope.js`) resolve from that
root. Publishing the repository root would serve the old pre-v1 game.

The fixture is not copied as-is. `npm run publish` also writes the lean
full pool and one `data/pools/<preset>.json` per preset, with a
`meta.json` holding the real counts. The home screen fetches only
`meta.json`; a preset game fetches only its slice. If those generated
files are missing, the client falls back to the full pool.

### Publish the game, not the repository

The repository also holds the pre-v1 game: an `index.html` at the root, its
own scripts under `js/`, and the raw data under `data/raw/`. Publishing the
repository as it stands would publish that older game too, on the same
address, with made-up players in it.

So publish a copy that holds only the game:

```bash
npm run publish          # writes dist/
```

`dist/` is the web root. It is a copy, not a build: the browser loads the
same files the repository holds. Nothing else goes out — not `supabase/`,
not `.env.local`, not `data/raw/`.

## The quick path

Fill `.env.local` (the template lists every value, and the file is
gitignored), then:

```bash
npm run deploy:hosted
```

That links the project, pushes the migrations, deploys the functions,
uploads the pool, writes `client/src/config.js`, publishes `dist/`, and
deploys it to Netlify under `NETLIFY_SITE_NAME`. It is safe to re-run.

The sections below are the same work by hand, and the reference for what
each step needs.

## 1. The Supabase project

Create a free project at supabase.com.

**Authentication → Providers → Anonymous → on.** The game has no accounts:
every player is an anonymous user, and the session is what ties a player
to a room.

**Storage → create a bucket called `pool`, not public.** The server reads
the player pool from it.

**The database and the functions:**

```bash
npx supabase login
npx supabase link --project-ref <your-ref>

npx supabase db push                       # the migrations
npm run supabase:deploy                    # the functions

SUPABASE_URL=https://<your-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key> \
  npm run supabase:upload                 # the player pool into Storage
```

`npm run supabase:deploy` copies the engine and the shared library into
`supabase/functions/_shared/vendor/` before it deploys. The deploy
bundler only includes what is inside `supabase/`, so an import that
points out of it is skipped and the deploy fails with "module not found"
on a file that is right there. The copy is generated, never edited and
never committed.

**Then point the client at the project:**

```bash
SUPABASE_URL=https://<your-ref>.supabase.co \
SUPABASE_ANON_KEY=<your-publishable-key> \
  npm run supabase:sync
```

and commit `client/src/config.js`. The anon key is public by definition —
it is the key that is allowed to be in a browser. It can read nothing: the
quiz plan and the answer key are behind row-level security that the anon
key cannot pass.

## 2. The web server

Any static host will do — the game is plain files. Two things matter:

- **The repository root is the web root**, so that `/client/`, `/js/`,
  `/lib/` and `/data/` resolve.
- **`/client/` is the entry point.** A visitor should land there.

If you host it at a subdomain, you also need to allow the game's origin
in **Authentication → URL Configuration**, and add it to the **Redirect
URLs**.

### A quick local check of the hosted build

```bash
SUPABASE_URL=https://<your-ref>.supabase.co SUPABASE_ANON_KEY=<key> \
  npm run supabase:sync
npm run dev
```

Or check exactly what you are about to publish:

```bash
npm run publish
npx serve dist          # or any static server
```

The game now talks to the hosted project, and the local server only
serves the files. Play it and check the console: the Supabase calls
should go to `<your-ref>.supabase.co`, not to `127.0.0.1`.

## 3. What to check after it is live

- [ ] The home screen shows the vibe cards with real counts (the counts load).
- [ ] A room can be created and the code is six characters.
- [ ] A second browser can join with that code and sees the same round.
- [ ] The clues reveal on the same clock for both players.
- [ ] The answer is scored by the server and the leaderboard updates.
- [ ] The service worker registers and the game still opens on a second visit.
- [ ] The fonts load from `/client/fonts/` and the page does not jump.
- [ ] A room reaches a stat round, the options carry their units, and the reveal shows the value with its unit.
- [ ] The host rematches after the final, round 1 of the new game starts in the same room, and the room code is unchanged.
- [ ] A steal still copies the target's answer and pays half their points.

## 4. The things that will bite

- **The edge functions must be deployed.** The client calls
  `start-room` and `submit-answer`; if they are not deployed, starting a
  room fails with a fetch error.
- **The player pool must be in Storage.** If the bucket is empty, the
  server cannot plan a quiz and says "unknown vibe".
- **Do not set `functionsUrl` by hand.** `npm run supabase:sync` writes
  `null` for a hosted project, which means "the project's own
  functions". A value left over from local development points every
  browser at `127.0.0.1`.
- **A phone on your wifi cannot join a room served from your laptop**
  unless the client points at an address the phone can reach. The
  Supabase URL is fine — it is public — but a local stack bound to
  `127.0.0.1` is not. This does not affect a hosted game.
- **A deployed service worker caches the shell.** The version is bumped
  when the shell changes; with the network first, a later deploy does not
  need a bump, but a browser that has an old worker will keep it until
  the page reloads.
