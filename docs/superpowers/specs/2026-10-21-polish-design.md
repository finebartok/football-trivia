# Polish — Phase 6 design

**Date:** 2026-10-21
**Status:** approved in conversation; written up here for review
**Builds on:** `docs/superpowers/specs/2026-10-20-football-trivia-v1-design.md` §10 (Phase 6)

---

## 1. What this is

The game is finished and playable. This phase is what it feels like to play: the sound, the movement, the states where something has gone wrong, and the ability to put it on your home screen.

The v1 spec lists six things: *Sound, haptics, motion, credits screen, empty/error states, PWA install*. The **credits screen already exists** (`client/src/screens/credits.js` — the data sources, the photo credits, the links). So this phase is five things.

Two facts about today shape the work:

- **The app is completely static.** There is not one transition or animation in the stylesheets. The `prefers-reduced-motion` rule exists and switches everything off, so it is currently switching off nothing.
- **A failed load is silent.** If the player pool cannot be fetched, the store swallows the error and the vibe cards sit on "…" forever, with no explanation and no way to try again.

### 1.1 The two decisions this design was built on

- **The sound is synthesised.** There are no audio assets in the repository and there is no way to record any, so every sound is a short oscillator with a gain envelope. Nothing to download, nothing to license, nothing to lose.
- **The PWA is a manifest and a service worker.** The shell is cached; the 3.7MB player pool never is. The game still needs a connection to play, and says so when it does not have one.

---

## 2. Sound and haptics

### 2.1 The module

`client/src/sound.js` — one module, imported by the screens that make noise. It owns the audio context, the mute, and the vibration.

```js
export const sounds = {
  click(): void,   // you tap an option
  right(): void,   // the reveal says you got it
  wrong(): void,   // the reveal says what it was
  tick(): void,    // the last five seconds of a round
  reveal(): void,  // a clue appears
};

export function isMuted(): boolean
export function setMuted(muted: boolean): void
export function soundToggle(): HTMLElement   // the button
export function haptic(pattern: number | number[]): void
```

### 2.2 How a sound is made

One oscillator, one gain node, one envelope: attack, decay, silence. The frequencies are the interval's — a chime is two notes a fifth apart, a thud is a low note that falls.

The `AudioContext` is created on the first gesture, because a mobile browser will not make a sound before one. The first tap on an option therefore both unlocks the context and plays the click.

### 2.3 The mute

A small speaker button in the topbar, on the home screen and in the round. It says whether sound is on, it has an `aria-label` that says so, and it toggles. The choice is remembered in local storage, and it is remembered **off** as well as on: a player who muted it once does not get a surprise.

Haptics follow the same switch. Muting the sound mutes the buzz.

### 2.4 Where each sound plays

| Sound | Where | Note |
|---|---|---|
| `click` | the round screen, when an option is tapped | only if the tap was not a double answer |
| `tick` | the round screen, once a second in the last five seconds | the clock is the only thing under pressure |
| `reveal` | the round screen, when a clue appears | one per clue, not one per stage |
| `right` | the reveal screen | |
| `wrong` | the reveal screen | |
| `haptic` | a clue reveals (10ms), a correct answer (30ms), a wrong one (60ms) | `navigator.vibrate`, which is Android and desktop-Chrome only; a no-op everywhere else |

### 2.5 The rules

- No sound ever plays before a gesture. A browser that refuses is not an error.
- A sound never blocks the game. If the audio context cannot be created, the game plays on in silence.
- Sound is never the only feedback. Every cue is also visible: the clue card appears, the verdict says it, the timer moves.

---

## 3. Motion

Four transitions, all in CSS, all switched off by the rule that already exists.

| What | How long | What it does |
|---|---|---|
| A clue card appears | 240ms | fades in and rises eight pixels |
| An option is pressed | 90ms | scales down slightly, and back |
| The verdict | 400ms | a short pulse, once |
| The screen changes | 180ms | fades in |

The rule stays: `@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }` — it is already in `client/styles/app.css` and it now has something to switch off.

Nothing moves a thing the player is reading. The clue ladder does not jump; the clue cards arrive in place.

---

## 4. Empty and error states

A pass over every screen, for the case where the thing the screen is about is not there.

| Case | What the player sees |
|---|---|
| **The player pool fails to load** | "Could not load the players. Check your connection." and a **Try again** button that fetches it again. Today the cards sit on "…" forever. |
| The saved-vibes list is empty | "Nothing saved yet. Craft one and it will be here." (exists) |
| A join code is not a room | "No room has that code." (exists) |
| A room is full | "That room is full." (exists) |
| A room cannot be played | "Only 3 players fit that vibe. A vibe needs at least 20." (exists) |
| A shared link is not a vibe | "That link is not a vibe we can play." (exists) |
| The results screen has no answers | "No rounds were played." and a way back |
| The backend is unreachable | "Multiplayer is unavailable right now." and a way to play solo |
| The browser is offline | "You are offline. The game needs a connection to play." |

Every one of them names what happened and offers the next thing, and none of them is a stack trace, a raw id, or a blank screen.

---

## 5. The PWA

### 5.1 The manifest

`client/manifest.webmanifest` — the name, the short name, the theme colour, the background colour, the display mode (`standalone`), the orientation, and the icons.

The icon is the football already in the favicon, written as an SVG. Browsers that want a raster icon get one: a 192 and a 512 PNG, generated once from the SVG and committed.

### 5.2 The service worker

`client/sw.js` — a hand-written worker, no build step, no dependency.

- **The shell is cached on the fly.** Every same-origin GET for the app's own files is cached as it is fetched. There is no manifest of files to keep in step.
- **The player pool is never cached.** It is 3.7MB and it changes when the data is rebuilt. A stale pool would be worse than no pool.
- **The HTML is network-first**, so a deploy is picked up on the next load; the static files are cache-first, so the game opens instantly.
- **An old cache is dropped** when the worker's version changes.
- **A fetch that fails and is not cached** returns a small offline page, which says the game needs a connection.

### 5.3 The install hint

When the browser fires `beforeinstallprompt`, the home screen shows a quiet line — "Add Football Trivia to your home screen" — with an **Add** button. It is not a modal, it is not a popup, and it disappears once the game is installed. A browser that never fires the event never shows it.

---

## 6. Testing

| Layer | Approach |
|---|---|
| The sound module | Node unit test: the mute is remembered, the toggle says the right thing, and calling a sound with no audio context does not throw. The audio itself is not asserted — a browser test cannot hear a tone. |
| The mute | Playwright: the button toggles, the state survives a reload, and the game still works with sound off. |
| The pool failure | Playwright: the fetch is made to fail, the message appears, and **Try again** recovers when the fetch works. |
| The PWA | Playwright: the manifest is served and parses, the service worker registers, and the offline page is what an uncached navigation gets. |
| Motion | A Playwright assertion that the reduced-motion rule is in the stylesheet, and that the classes the transitions need are on the elements. Motion itself is not asserted — a screenshot diff is a test that fails for the wrong reasons. |

---

## 7. What is deliberately not built

- **No music and no ambience.** One-shot sounds only. A loop that has to be muted, paused and resumed is a different feature.
- **No sound settings screen.** One toggle, in the topbar, is enough.
- **No offline play.** The pool and the room both need a connection. The PWA makes the game open fast and installable, not playable without a network.
- **No animation library.** Four CSS transitions, and the rule that switches them off.
- **Nothing that changes how the game plays.** This phase is the feel, not the rules.

---

## 8. The files this phase adds or changes

```
client/src/sound.js                    new - the synthesiser, the mute, the haptics
client/src/screens/home.js             edited - the mute button, the install hint
client/src/screens/round.js            edited - the sounds, the mute button
client/src/screens/reveal.js           edited - the sounds
client/src/screens/results.js          edited - the empty state
client/src/store.js                    edited - the pool failure is kept, not swallowed
client/styles/app.css                  edited - the transitions
client/styles/screens/round.css        edited - the clue and verdict motion
client/manifest.webmanifest            new
client/sw.js                           new
client/icons/icon.svg, icon-192.png, icon-512.png   new
tests/shared/sound.test.js             new
tests/client/polish.spec.js            new
```

---

## 9. Open questions for the implementer

None that change the shape of the work. Two small ones, answered here so they are not reopened:

- **The sound's character is not a taste question with one right answer.** The implementer picks frequencies that sound like the retro theme and does not change them without a reason.
- **The service worker caches the shell on the fly rather than from a list.** A list is the more common way and it goes stale the moment a file is renamed; the on-the-fly way has one rule — the app's own files are cached, the pool is not — and nothing to keep in step.
