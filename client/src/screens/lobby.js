import { el, mount } from '../ui.js';
import { store } from '../store.js';
import { countFor } from '../pool.js';
import { room } from '../room.js';

function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join(' ');
}

export function render(root) {
  const scope = store.state.scope;
  if (!scope) {
    location.hash = '#home';
    return;
  }

  const count = countFor({ clauses: scope.clauses });
  const code = roomCode();

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

    el('section', { className: 'card room-code' }, [
      el('p', { className: 'muted-note', text: 'Share this code so your friends can join' }),
      el('p', { className: 'room-code__value', text: code, attrs: { id: 'room-code' } }),
      el('button', {
        className: 'btn btn--tiny',
        text: 'Copy code',
        attrs: { type: 'button' },
        on: {
          click: (e) => {
            navigator.clipboard?.writeText(code.replace(/ /g, '')).then(() => {
              e.target.textContent = 'Copied';
            }).catch(() => {});
          },
        },
      }),
    ]),

    el('section', { className: 'card vibe-summary' }, [
      el('span', { className: 'vibe-summary__icon', text: scope.icon || '⚽' }),
      el('div', { className: 'vibe-summary__body' }, [
        el('h1', { className: 'page-title', text: scope.name }),
        el('p', { className: 'muted-note', text: `${count} players in the pool` }),
      ]),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'In the room' }),
      el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: 'You' }),
        el('span', { className: 'muted-note', text: 'host' }),
      ]),
      el('p', {
        className: 'muted-note',
        text: 'Friends join with the code above. Multiplayer arrives with the room phase.',
      }),
    ]),

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
