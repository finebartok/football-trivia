# Multiplayer

The game works on its own: pick a vibe, play ten rounds, no backend. This
is how to run the room.

## Locally

```bash
npm run supabase:start              # the local stack (about 10GB of images)
npm run supabase:reset              # apply the migrations
npm run supabase:sync               # write client/src/config.js
npm run supabase:upload             # put the player pool in Storage
npm run supabase:serve              # serve the edge functions
npm run dev                         # the game on http://localhost:8099/
```

Open two browsers, create a room in one, join it in the other with the
code.

`npm run supabase:serve` runs the edge functions from Node. The hosted
project runs them from Supabase's edge runtime, from the same code - the
handlers are ordinary Request/Response functions and the entry points in
`supabase/functions/` are three lines each.

## If the local edge runtime will not boot

`supabase functions serve` may fail with:

```
worker boot error: failed to create the graph: Permission denied (os error 13)
```

That is not a bug in the game. It means the host's SELinux policy has
no rules for containers, so the edge runtime's workers cannot read the
function sources. The fix is on the host:

```bash
sudo dnf install docker-ce-selinux    # or: sudo setenforce 0
sudo systemctl restart docker
```

Until then, `npm run supabase:serve` serves the same functions locally
and everything works - the integration tests and the two-browser test
both run against it.

## On a hosted project

1. Create a free project at supabase.com.
2. Authentication -> Providers -> Anonymous -> on.
3. `npx supabase login` and `npx supabase link --project-ref <ref>`.
4. `npx supabase db push` - the migrations.
5. `npx supabase functions deploy pool-count`,
   `npx supabase functions deploy start-room` and
   `npx supabase functions deploy submit-answer`.
6. Storage -> create a bucket called `pool`, not public.
7. `SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<publishable key> FUNCTIONS_URL=null npm run supabase:sync`
   and commit the result.
8. `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run supabase:upload`.

The anon key in `client/src/config.js` is public by definition. It can
read nothing: the quiz plan and the answer key are behind row-level
security that the anon key cannot pass.
