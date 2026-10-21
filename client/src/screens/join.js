import { el, mount } from '../ui.js';
import { room } from '../room.js';

export function render(root) {
  const codeInput = el('input', {
    className: 'text-input',
    attrs: {
      type: 'text',
      id: 'join-code',
      placeholder: 'ABC234',
      maxlength: '6',
      autocapitalize: 'characters',
      autocomplete: 'off',
    },
  });

  const nameInput = el('input', {
    className: 'text-input',
    attrs: {
      type: 'text',
      id: 'join-name',
      placeholder: 'Your name',
      maxlength: '24',
      autocomplete: 'off',
    },
  });

  const errorEl = el('p', { className: 'muted-note', attrs: { id: 'join-error' } });

  const join = el('button', {
    className: 'btn btn--primary',
    text: 'Join the room',
    attrs: { type: 'button', id: 'btn-join' },
    on: {
      click: async () => {
        join.disabled = true;
        join.textContent = 'Joining…';
        const joined = await room.join({
          code: codeInput.value.trim(),
          displayName: nameInput.value.trim() || 'Player',
        });
        if (joined) {
          location.hash = '#room-lobby';
        } else {
          join.disabled = false;
          join.textContent = 'Join the room';
          errorEl.textContent = room.state.error ?? 'Could not join that room.';
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
      errorEl,
    ]),
  ]);
}
