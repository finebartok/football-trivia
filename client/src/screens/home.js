import { el, mount } from '../ui.js';
import { soundToggle } from '../sound.js';
import { store, notify } from '../store.js';
import { PRESETS, countFor } from '../pool.js';

// The browser's offer to install the game. It is a quiet line, not a
// popup, and a browser that never offers it never shows it.
let installPrompt = null;

globalThis.addEventListener?.('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  notify();
});

function topbar() {
  const next = store.state.theme === 'retro' ? 'editorial' : 'retro';
  return el('header', { className: 'topbar' }, [
    el('a', {
      className: 'wordmark',
      text: '⚽ Football Trivia',
      attrs: { href: '#home' },
    }),
    el('button', {
      className: 'btn btn--icon',
      text: store.state.theme === 'retro' ? 'Editorial' : 'Retro',
      attrs: { title: 'Switch theme', 'aria-label': 'Switch theme' },
      on: {
        click: () => {
          store.setTheme(next);
        },
      },
    }),
    soundToggle(),
  ]);
}

function presetCard(preset) {
  // The published counts arrive in a tiny file. The full pool arrives only
  // if the metadata did not - local development, or an older deploy.
  const metaCount = store.state.poolCounts?.[preset.id];
  const live = store.state.poolKey === 'full'
    ? countFor({ clauses: preset.clauses })
    : null;
  const count = metaCount ?? live;
  // Without a count a preset has no quiz to start. The error above the
  // list offers the retry.
  const ready = count != null || Boolean(store.state.pool);
  const countLabel = count != null ? `${count} players` : ready ? 'Players ready' : '…';
  return el('button', {
    className: 'vibe-card vibe-card--preset',
    attrs: ready ? { type: 'button' } : { type: 'button', disabled: '' },
    on: ready ? {
      click: () => {
        store.setScope({ id: preset.id, name: preset.name, icon: preset.icon, clauses: preset.clauses });
        location.hash = '#lobby';
      },
    } : {},
  }, [
    el('span', { className: 'vibe-card__icon', text: preset.icon }),
    el('span', { className: 'vibe-card__body' }, [
      el('strong', { className: 'vibe-card__name', text: preset.name }),
      el('span', { className: 'vibe-card__desc', text: preset.desc }),
    ]),
    el('span', { className: 'vibe-card__count', text: countLabel }),
  ]);
}

function savedCard(vibe) {
  // A saved vibe may have been edited, so its players cannot be assumed
  // to be a preset's slice. The lobby fetches what it needs.
  const ready = Boolean(store.state.poolCounts || store.state.pool);
  return el('div', { className: 'vibe-card vibe-card--saved' }, [
    el('span', { className: 'vibe-card__icon', text: vibe.icon || '⚽' }),
    el('span', { className: 'vibe-card__body' }, [
      el('strong', { className: 'vibe-card__name', text: vibe.name }),
      el('span', { className: 'vibe-card__desc', text: 'Your vibe' }),
    ]),
    el('span', { className: 'vibe-card__actions' }, [
      el('button', {
        className: 'btn btn--primary btn--tiny',
        text: 'Play',
        attrs: ready
          ? { type: 'button' }
          : { type: 'button', disabled: '' },
        on: ready ? {
          click: () => {
            store.setScope({ id: vibe.id, name: vibe.name, icon: vibe.icon, clauses: vibe.clauses });
            location.hash = '#lobby';
          },
        } : {},
      }),
      el('button', {
        className: 'btn btn--tiny',
        text: '✕',
        attrs: { type: 'button', 'aria-label': `Delete ${vibe.name}` },
        on: {
          click: () => {
            store.deleteVibe(vibe.id);
          },
        },
      }),
    ]),
  ]);
}

export function render(root) {
  // The counts arrive from a tiny file. The players themselves are not
  // fetched until the player picks a vibe and reaches the lobby.
  store.ensureCounts().catch(() => {});
  const vibes = store.state.vibes;
  const children = [
    topbar(),
    el('section', { className: 'hero' }, [
      el('h1', { className: 'hero__title', text: 'Craft a vibe' }),
      el('p', {
        className: 'hero__sub',
        text: 'Pick the football you want. A quiz gets written around it.',
      }),
      el('a', {
        className: 'btn btn--primary hero__cta',
        text: 'Craft a vibe',
        attrs: { href: '#vibes' },
      }),
    ]),
    el('h2', { className: 'section-title', text: 'Play together' }),
    el('div', { className: 'vibe-grid' }, [
      el('a', { className: 'vibe-card vibe-card--door', attrs: { href: '#vibes' } }, [
        el('span', { className: 'vibe-card__icon', text: '👥' }),
        el('span', { className: 'vibe-card__body' }, [
          el('strong', { className: 'vibe-card__name', text: 'Create a room' }),
          el('span', { className: 'vibe-card__desc', text: 'Pick a vibe, get a code, invite your friends' }),
        ]),
      ]),
      el('a', { className: 'vibe-card vibe-card--door', attrs: { href: '#join' } }, [
        el('span', { className: 'vibe-card__icon', text: '🔑' }),
        el('span', { className: 'vibe-card__body' }, [
          el('strong', { className: 'vibe-card__name', text: 'Join a room' }),
          el('span', { className: 'vibe-card__desc', text: 'Got a code? Type it in' }),
        ]),
      ]),
    ]),
    store.state.poolError
      ? el('section', { className: 'card notice notice--warn', attrs: { id: 'pool-error' } }, [
        el('p', { text: store.state.poolError }),
        el('button', {
          className: 'btn btn--primary',
          text: 'Try again',
          attrs: { type: 'button', id: 'pool-retry' },
          on: {
            click: async (e) => {
              // The button is held onto: by the time the retry is done
              // the event is over and currentTarget is gone.
              const button = e.currentTarget;
              button.disabled = true;
              await store.retryPool();
              button.disabled = false;
            },
          },
        }),
      ])
      : null,
    installPrompt
      ? el('div', { className: 'install-hint', attrs: { id: 'install-hint' } }, [
        el('span', { text: 'Add Football Trivia to your home screen' }),
        el('button', {
          className: 'btn btn--tiny',
          text: 'Add',
          attrs: { type: 'button' },
          on: {
            click: async () => {
              const prompt = installPrompt;
              installPrompt = null;
              notify();
              if (prompt) await prompt.prompt();
            },
          },
        }),
      ])
      : null,
    el('h2', { className: 'section-title', text: 'Start from a vibe' }),
    el('div', { className: 'vibe-grid' }, PRESETS.map(presetCard)),
    el('h2', { className: 'section-title', text: 'Your vibes' }),
  ];

  if (vibes.length === 0) {
    children.push(
      el('p', { className: 'muted-note', text: 'Nothing saved yet. Craft one and it will be here.' }),
    );
  } else {
    children.push(el('div', { className: 'vibe-grid' }, vibes.map(savedCard)));
  }

  children.push(
    el('footer', { className: 'home-foot' }, [
      el('a', { className: 'muted-note', text: 'Photo credits & sources', attrs: { href: '#credits' } }),
    ]),
  );

  mount(root, children);
}
