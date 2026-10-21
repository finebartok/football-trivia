# Vibes

A vibe is a scope: a set of clauses that decide which players a quiz is
written about. Nobody sees that word. The player says "vibe", and
"craft" is what they do to one.

## Where a vibe lives

- **Presets** are in `js/presets.js`. Seven of them, shared by the browser
  and the server.
- **Crafted vibes** live in the browser's storage, on the phone that
  made them. There is no account and no server copy.
- **A shared vibe** travels in the link. The link carries the vibe's
  definition, in the URL fragment, so it never reaches a server.

## The floor

Twenty players. A vibe with fewer cannot produce a quiz, so it cannot be
saved and it cannot start a game. The builder says how many there are
rather than refusing a number you typed.

## Playing a crafted vibe in a room

The room carries the vibe's clauses. The server checks the shape of
what it is given - the competitions, clubs, nations and tournaments it
names, the stats it measures - before it writes a quiz. A preset room
uses the preset's own clauses, so a crafted scope never changes what a
preset means.

## The words

The player-facing noun is "vibe" and the verb is "craft". A stat is
"goals aged 30+", never `goals_after_age_30`. A room's scope is never
shown to a player.
