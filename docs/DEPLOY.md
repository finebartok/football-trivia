# Deploying

The game is a static site plus a Supabase project. Nothing needs a build
step: the browser loads the same files the repository holds.

## What goes where

| Piece | Where it goes |
|---|---|
| `client/` | the web root, at `/client/` |
| `js/engine/`, `lib/` | the web root — the client imports them by absolute path |
| `data/fixtures/pool.sample.json` | the web root — the browser fetches the player pool |
| `client/fonts/` | the web root — the fonts are ours, not a third party's |
| `supabase/migrations/` | the Supabase database |
| `supabase/functions/` | the Supabase edge functions |

**The web root is the repository root**, because the client's paths are
absolute: `/client/index.html` imports `/js/engine/index.js`, which imports
`/lib/scope.js`. If you host the game somewhere else, those paths have to
change too.

Do not publish `supabase/`, `.env.local`, or anything under `data/raw/`.

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
npx supabase functions deploy start-room
npx supabase functions deploy submit-answer

SUPABASE_URL=https://<your-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key> \
  npm run supabase:upload                 # the player pool into Storage
```

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

The game now talks to the hosted project, and the local server only
serves the files. Play it and check the console: the Supabase calls
should go to `<your-ref>.supabase.co`, not to `127.0.0.1`.

## 3. What to check after it is live

- [ ] The home screen shows the vibe cards with real counts (the pool loads).
- [ ] A room can be created and the code is six characters.
- [ ] A second browser can join with that code and sees the same round.
- [ ] The clues reveal on the same clock for both players.
- [ ] The answer is scored by the server and the leaderboard updates.
- [ ] The service worker registers and the game still opens on a second visit.
- [ ] The fonts load from `/client/fonts/` and the page does not jump.

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
