import { store } from './store.js';
import { clear } from './ui.js';
import * as home from './screens/home.js';
import * as vibes from './screens/vibes.js';
import * as lobby from './screens/lobby.js';
import * as round from './screens/round.js';
import * as reveal from './screens/reveal.js';
import * as results from './screens/results.js';
import * as credits from './screens/credits.js';

const SCREENS = {
  '#home': home,
  '#vibes': vibes,
  '#lobby': lobby,
  '#round': round,
  '#reveal': reveal,
  '#results': results,
  '#credits': credits,
};

let rendering = false;

function screenFor(hash) {
  const screen = SCREENS[hash];
  if (screen && typeof screen.render === 'function') return screen;
  return SCREENS['#home'];
}

export function render() {
  if (rendering) return;
  rendering = true;
  try {
    document.documentElement.dataset.theme = store.state.theme;
    const hash = location.hash || '#home';
    const screen = screenFor(hash);
    const app = document.getElementById('app');
    if (!app) return;
    clear(app);
    screen.render(app);
  } finally {
    rendering = false;
  }
}

window.addEventListener('hashchange', render);
store.subscribe(render);

// Mount the current hash immediately (synchronously) so the screen is on
// paint even before the async pool load resolves; store notifications
// re-render afterwards, guarded against re-entrancy.
render();
store.init().then(render).catch(() => render());
