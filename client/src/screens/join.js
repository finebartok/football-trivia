import { el, mount } from '../ui.js';
import { room } from '../room.js';

// The screen is rebuilt whenever the store says something changed, so
// what the player has typed has to live outside it.
let typedCode = '';
let typedName = '';

export function render(root) {
  const codeInput = el('input', {
    className: 'text-input text-input--code',
    attrs: {
      type: 'text',
      id: 'join-code',
      placeholder: 'ABC234',
      maxlength: '6',
      autocapitalize: 'characters',
      autocomplete: 'off',
      value: typedCode,
    },
    on: {
      input: (e) => { typedCode = e.currentTarget.value; },
    },
  });

  const nameInput = el('input', {
    className: 'text-input text-input--plain',
    attrs: {
      type: 'text',
      id: 'join-name',
      placeholder: 'Your name',
      maxlength: '24',
      autocomplete: 'off',
      value: typedName,
    },
    on: {
      input: (e) => { typedName = e.currentTarget.value; },
    },
  });

  const join = el('button', {
    className: 'btn btn--primary',
    text: 'Join the room',
    attrs: { type: 'button', id: 'btn-join' },
    on: {
      click: async () => {
        join.disabled = true;
        join.textContent = 'Joining…';
        const joined = await room.join({
          code: typedCode.trim(),
          displayName: typedName.trim() || 'Player',
        });
        if (joined) {
          location.hash = '#room-lobby';
        } else {
          join.disabled = false;
          join.textContent = 'Join the room';
        }
      },
    },
  });

  mount(root, [
    el('header', { className: 'topbar' }, [
      el('a', { className: 'wordmark', text: '← Back', attrs: { href: '#home' } }),
    ]),
    el('section', { className: 'card' }, [
      el('h1', { className: 'page-title', text: 'Join a room' }),
      el('p', { className: 'muted-note', text: 'Type the code your host is showing you.' }),
      codeInput,
      nameInput,
      join,
      // The message comes from the room's state, not from a node that the
      // next redraw would throw away.
      el('p', { className: 'muted-note', attrs: { id: 'join-error' } }, room.state.error ?? ''),
    ]),
  ]);
}
