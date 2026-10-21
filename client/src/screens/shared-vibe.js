import { el, mount } from '../ui.js';
import { store } from '../store.js';
import { countFor } from '../pool.js';
import { decodeScope, describeScope } from '/lib/scope.js';

export function render(root) {
  // The count is the feedback: how many players this vibe reaches.
  store.ensurePool().catch(() => {});

  const code = new URLSearchParams((location.hash.split('?')[1] ?? '')).get('c');
  const scope = decodeScope(code);

  if (!scope) {
    mount(root, [
      el('section', { className: 'card' }, [
        el('h1', { className: 'page-title', text: 'That link is not a vibe' }),
        el('p', { className: 'muted-note', attrs: { id: 'vibe-error' } },
          'That link is not a vibe we can play.'),
        el('a', { className: 'btn btn--primary', text: 'Start from a vibe', attrs: { href: '#vibes' } }),
      ]),
    ]);
    return;
  }

  store.setScope({
    id: 'shared',
    name: scope.name || 'A shared vibe',
    icon: scope.icon || '⚽',
    clauses: scope.clauses,
  });

  const count = countFor({ clauses: scope.clauses });

  mount(root, [
    el('section', { className: 'card vibe-summary' }, [
      el('span', { className: 'vibe-summary__icon', text: scope.icon || '⚽' }),
      el('div', { className: 'vibe-summary__body' }, [
        el('h1', { className: 'page-title', text: scope.name || 'A shared vibe' }),
        el('p', { className: 'muted-note', text: describeScope(scope, store.state.registry) }),
      ]),
      el('div', { className: 'vibe-summary__count', id: 'pool-count' }, [
        el('strong', { text: String(count) }),
        el('span', { text: count === 1 ? 'player' : 'players' }),
      ]),
    ]),
    el('a', { className: 'btn btn--primary', text: 'Play this vibe', attrs: { href: '#vibes' } }),
    el('a', { className: 'btn btn--ghost', text: 'Make it ours', attrs: { href: '#vibes' } }),
  ]);
}
