# Feel

How the game sounds, moves, and behaves when something goes wrong.

## Sound

Every sound is synthesised in the browser - a short oscillator with a gain
envelope. There are no audio files, so there is nothing to download and
nothing to license.

The speaker button in the topbar turns the sound off. The choice is
remembered, in both directions, and the buzz that goes with it follows
the same switch. A browser with no Web Audio plays on in silence.

Sound is never the only feedback. A clue appears, the verdict says it,
the timer moves.

## Movement

Four small transitions: a clue arrives in place, a button presses in,
the verdict pulses, the screen fades in. A player who has asked their
system for less movement gets none of it - the rule is in
`client/styles/app.css` and it applies to everything.

## When something goes wrong

Every screen says what happened and offers the next thing. The pool not
loading is the one that matters: the screen says so and offers a way to
try again, rather than leaving an ellipsis on the cards forever.

## On your home screen

The game has a manifest, an icon and a service worker, so it can be
added to the home screen and opens instantly. The service worker caches
the app's own files as they are fetched - there is no list to keep in
step. The player pool is never cached, and the game still needs a
connection to play.
