import { el, mount } from '../ui.js';
import { store } from '../store.js';
import { room } from '../room.js';

export function render(root) {
  const roomState = store.state.room;

  if (!roomState?.roomId) {
    location.hash = '#home';
    return;
  }

  // The game started: follow it.
  if (roomState.round) {
    location.hash = '#round';
    return;
  }

  const isHost = roomState.members.some((m) => m.user_id === roomState.me && m.is_host);

  const me = roomState.members.find((m) => m.user_id === roomState.me);
  const nameInput = el('input', {
    className: 'text-input',
    attrs: {
      type: 'text',
      id: 'room-name',
      placeholder: 'Your name',
      maxlength: '24',
      value: me?.display_name ?? '',
    },
  });
  const nameButton = el('button', {
    className: 'btn btn--tiny',
    text: 'Save name',
    attrs: { type: 'button' },
    on: {
      click: async () => {
        nameButton.disabled = true;
        await room.setName(nameInput.value.trim() || 'Player');
        nameButton.disabled = false;
      },
    },
  });

  const start = isHost
    ? el('button', {
      className: 'btn btn--primary',
      text: 'Start the quiz',
      attrs: { type: 'button', id: 'btn-start' },
      on: {
        click: async () => {
          start.disabled = true;
          start.textContent = 'Writing your quiz…';
          const started = await room.start();
          if (started) {
            location.hash = '#round';
          } else {
            start.disabled = false;
            start.textContent = 'Start the quiz';
          }
        },
      },
    })
    : el('p', { className: 'muted-note', text: 'Waiting for the host to start the quiz.' });

  mount(root, [
    el('header', { className: 'topbar' }, [
      el('a', { className: 'wordmark', text: '← Back', attrs: { href: '#home' } }),
    ]),

    el('section', { className: 'card room-code' }, [
      el('p', { className: 'muted-note', text: 'Share this code so your friends can join' }),
      el('p', { className: 'room-code__value', text: roomState.code ?? '', attrs: { id: 'room-code' } }),
      el('button', {
        className: 'btn btn--tiny',
        text: 'Copy code',
        attrs: { type: 'button' },
        on: {
          click: (e) => {
            navigator.clipboard?.writeText((roomState.code ?? '').replace(/ /g, '')).then(() => {
              e.target.textContent = 'Copied';
            }).catch(() => {});
          },
        },
      }),
    ]),

    el('section', { className: 'card vibe-summary' }, [
      el('span', { className: 'vibe-summary__icon', text: roomState.scopeIcon || '⚽' }),
      el('div', { className: 'vibe-summary__body' }, [
        el('h1', { className: 'page-title', text: roomState.scopeName || 'Your vibe' }),
        el('p', { className: 'muted-note', text: 'A quiz is written around your vibe' }),
      ]),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'In the room' }),
      el('div', { attrs: { id: 'room-players' } }, roomState.members.map((m) => el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: m.display_name }),
        el('span', { className: 'muted-note', text: m.is_host ? 'host' : '' }),
      ]))),
      el('p', { className: 'muted-note', text: 'The game starts when the host is ready.' }),
      nameInput,
      nameButton,
    ]),

    el('p', { className: 'fresh-quiz-note', text: 'A fresh quiz is written every time you play.' }),

    // Why nothing happened, if something did.
    roomState.error
      ? el('p', { className: 'notice notice--warn', attrs: { id: 'room-error' } }, roomState.error)
      : null,

    start,

    el('button', {
      className: 'btn btn--ghost',
      text: 'Leave this room',
      attrs: { type: 'button', id: 'btn-leave' },
      on: {
        click: async () => {
          await room.leave();
          location.hash = '#home';
        },
      },
    }),
  ]);
}
