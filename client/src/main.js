import { store } from './store.js';
import { room } from './room.js';
import { clear, el } from './ui.js';
import * as home from './screens/home.js';
import * as vibes from './screens/vibes.js';
import * as lobby from './screens/lobby.js';
import * as join from './screens/join.js';
import * as roomLobby from './screens/room-lobby.js';
import * as sharedVibe from './screens/shared-vibe.js';
import * as round from './screens/round.js';
import * as reveal from './screens/reveal.js';
import * as results from './screens/results.js';
import * as credits from './screens/credits.js';

const SCREENS = {
  '#home': home,
  '#vibes': vibes,
  '#lobby': lobby,
  '#join': join,
  '#room-lobby': roomLobby,
  '#vibe': sharedVibe,
  '#round': round,
  '#reveal': reveal,
  '#results': results,
  '#credits': credits,
};

const ROOM_SCREENS = new Set(['#join', '#room-lobby', '#round', '#reveal', '#results']);

let rendering = false;
let lastHash = null;
// A press can span a two-second room sync. Rebuilding the screen while
// the pointer is down replaces the button under the finger, and the
// browser never fires the click. Defer store-driven renders until the
// press is over.
let pointerDown = false;
let pendingRender = false;

function screenFor(hash) {
  const screen = SCREENS[hash];
  if (screen && typeof screen.render === 'function') return screen;
  return SCREENS['#home'];
}

function renderNow() {
  if (rendering) return;
  rendering = true;
  try {
    document.documentElement.dataset.theme = store.state.theme;
    // A hash may carry a query - '#vibe?c=...' is still the vibe screen.
    const hash = (location.hash.split('?')[0]) || '#home';
    const screen = screenFor(hash);
    const app = document.getElementById('app');
    if (!app) return;

    // Remember what the player was typing in. A redraw replaces the
    // whole screen, and without this a field that is being typed into
    // loses the focus after one character.
    const active = document.activeElement;
    const focusId = active && active.id ? active.id : null;
    let caret = null;
    if (focusId && typeof active.selectionStart === 'number') caret = active.selectionStart;

    clear(app);

    // The fade belongs to a change of screen, not to a redraw. The room
    // redraws every two seconds, and a screen that faded in every two
    // seconds was the flicker.
    if (hash !== lastHash) {
      lastHash = hash;
      // The error from the last screen does not travel with the player.
      room.clearError();
      app.classList.remove('screen');
      void app.offsetWidth;
      app.classList.add('screen');
    }

    // A room screen needs the room, and the room is only known once the
    // session is back. Show nothing until then rather than bouncing the
    // player to the home screen.
    if (store.state.booting && ROOM_SCREENS.has(hash)) {
      app.appendChild(el('p', { className: 'muted-note', text: 'Getting the room…' }));
      return;
    }

    screen.render(app);

    if (focusId) {
      const next = document.getElementById(focusId);
      if (next && typeof next.focus === 'function') {
        next.focus();
        if (caret !== null && typeof next.setSelectionRange === 'function') {
          try {
            next.setSelectionRange(caret, caret);
          } catch {
            // Not every kind of field has a caret - a number input does
            // not, and it keeps the focus anyway.
          }
        }
      }
    }
  } finally {
    rendering = false;
  }
}

export function render() {
  if (pointerDown) {
    pendingRender = true;
    return;
  }
  renderNow();
}

function releasePointer() {
  pointerDown = false;
  if (!pendingRender) return;
  pendingRender = false;
  // The click for this press is dispatched after pointerup. A zero-delay
  // task lets that click run against the live element first.
  setTimeout(render, 0);
}

window.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  pointerDown = true;
}, true);

window.addEventListener('pointerup', (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  releasePointer();
}, true);

window.addEventListener('pointercancel', releasePointer, true);

window.addEventListener('hashchange', renderNow);
store.subscribe(render);

// Mount the current hash immediately (synchronously) so the screen is on
// paint even before the async pool load resolves; store notifications
// re-render afterwards, guarded against re-entrancy.
render();
store.init().then(render).catch(() => render());
