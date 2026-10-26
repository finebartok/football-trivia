import { el, mount } from '../ui.js';
import { store } from '../store.js';
import { countFor } from '../pool.js';
import { room } from '../room.js';

export function render(root) {
  const scope = store.state.scope;
  if (!scope) {
    location.hash = '#home';
    return;
  }

  const poolKey = store.poolKeyFor(scope);
  const poolReady = Boolean(store.state.pool)
    && (store.state.poolKey === poolKey || store.state.poolKey === 'full');
  // A preset needs only its own players; a hand-built vibe needs them all.
  if (!poolReady) store.ensurePool(scope).catch(() => {});
  const count = poolReady
    ? countFor({ clauses: scope.clauses })
    : store.state.poolCounts?.[poolKey];
  const countLabel = count != null ? `${count} players in the pool` : 'Loading players…';

  const start = el('button', {
    className: 'btn btn--primary',
    text: 'Start the quiz',
    attrs: { type: 'button', id: 'btn-start' },
    on: {
      click: async () => {
        start.disabled = true;
        start.textContent = 'Writing your quiz…';
        try {
          await store.startQuiz({ scope, seed: Math.floor(Math.random() * 1e9) });
          location.hash = '#round';
        } catch (err) {
          start.disabled = false;
          start.textContent = 'Start the quiz';
          store.setScope(scope);
        }
      },
    },
  });

  mount(root, [
    el('header', { className: 'topbar' }, [
      el('a', { className: 'wordmark', text: '← Back', attrs: { href: '#home' } }),
    ]),

    el('section', { className: 'card vibe-summary' }, [
      el('span', { className: 'vibe-summary__icon', text: scope.icon || '⚽' }),
      el('div', { className: 'vibe-summary__body' }, [
        el('h1', { className: 'page-title', text: scope.name }),
        el('p', { className: 'muted-note', text: countLabel }),
      ]),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'On your own' }),
      el('p', {
        className: 'muted-note',
        text: 'Ten questions, one clock. You can invite friends instead and play the same quiz in a room.',
      }),
    ]),

    el(
      'p',
      { className: 'muted-note', attrs: { id: 'lobby-error' } },
      room.state.error ?? store.state.poolError ?? '',
    ),

    el('p', { className: 'fresh-quiz-note', text: 'A fresh quiz is written every time you play.' }),

    start,

    el('div', { className: 'vibe-actions' }, [
      el('button', {
        className: 'btn btn--ghost',
        text: 'Create a room instead',
        attrs: { type: 'button', id: 'btn-create-room' },
        on: {
          click: async (e) => {
            const button = e.currentTarget;
            button.disabled = true;
            button.textContent = 'Creating…';
            const created = await room.create({ scope });
            if (created) {
              location.hash = '#room-lobby';
            } else {
              button.disabled = false;
              button.textContent = 'Create a room instead';
            }
          },
        },
      }),
    ]),
  ]);
}
