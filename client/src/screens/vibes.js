import { el, mount } from '../ui.js';
import { store } from '../store.js';
import { room } from '../room.js';
import { PRESETS, countFor } from '../pool.js';
import { scopePool } from '/js/engine/index.js';
import { nearestThreshold, describeCoverage, metricLabel } from '/lib/scope.js';
import {
  MIN_POOL, MOVES, STAT_MOVES, STAT_METRICS,
  erasFor, competitionsFor, clubsFor, nationsFor, tournamentsFor, applyMove, moveRow, shareLink,
} from '../vibe-moves.js';

export function render(root) {
  // The pool counts and the moves need the player pool.
  store.ensurePool().catch(() => {});
  const players = store.state.pool?.players ?? [];
  const registry = store.state.registry;

  // Start from the saved scope, or the first preset.
  const base = store.state.scope ?? { ...PRESETS[0], clauses: PRESETS[0].clauses };
  // A room is created from a vibe, and the vibe has to exist. The home
  // screen's door arrives here with no scope chosen yet.
  if (!store.state.scope) {
    store.setScope({ id: base.id, name: base.name, icon: base.icon, clauses: base.clauses });
  }
  let vibe = { id: base.id, name: base.name, icon: base.icon, clauses: base.clauses };

  const count = countFor({ clauses: vibe.clauses });
  const tooSmall = count < MIN_POOL;

  // The screen is rebuilt whenever the scope changes, which happens on
  // every keystroke in the threshold field. The field the player is typing
  // in keeps its focus and caret: main.js restores them after a redraw.
  const rerender = () => render(root);

  const options = {
    era: erasFor(players).map((e) => ({ key: `${e.start}-${e.end}`, label: e.label, value: e })),
    competition: competitionsFor(registry, players).map((c) => ({ key: c.id, label: `${c.name} (${c.players})`, value: c })),
    club: clubsFor(players).map((c) => ({ key: c.id, label: `${c.name} (${c.players})`, value: c })),
    nation: nationsFor(players).map((n) => ({ key: n.id, label: `${n.name} (${n.players})`, value: n })),
    tournament: tournamentsFor(registry, players).map((t) => ({ key: t.id, label: `${t.name} (${t.players})`, value: t })),
    stat: STAT_MOVES.map((s) => ({ key: `${s.id}-${s.value}`, label: s.label, value: s })),
  };

  // The threshold the scope already carries, and the suggestion: the
  // nearest threshold that still holds.
  const statMetric = vibe.clauses?.[0]?.stats?.[0]?.metric ?? STAT_METRICS[0].id;
  const thresholdValue = Number(vibe.clauses?.[0]?.stats?.[0]?.value ?? 50);
  // The count and the suggestion are about the vibe as it stands - the
  // competition, the era and all. A suggestion that does not hold would
  // be worse than no suggestion.
  const withThreshold = (value) => ({
    clauses: vibe.clauses.map((c) => ({
      ...c,
      stats: [
        ...(c.stats ?? []).filter((s) => s.metric !== statMetric),
        { metric: statMetric, op: '>=', value },
      ],
    })),
  });
  const typedCount = scopePool(withThreshold(thresholdValue), players).length;
  const suggestion = typedCount < MIN_POOL
    ? nearestThreshold({
      scope: withThreshold(thresholdValue),
      metric: statMetric,
      players,
      floor: MIN_POOL,
      max: 1000,
    })
    : null;

  // The suggestion only exists when there is one.
  const metricSelect = el('select', {
    className: 'text-input',
    attrs: { id: 'stat-metric' },
    on: {
      change: (e) => {
        const metric = e.currentTarget.value;
        const value = Number(thresholdInput.value);
        onPick({ id: 'stat' }, { metric, op: '>=', value: Number.isFinite(value) ? value : 50 });
      },
    },
  }, STAT_METRICS.map((m) => el('option', { text: m.label, attrs: { value: m.id } })));
  metricSelect.value = statMetric;

  const thresholdInput = el('input', {
    className: 'text-input text-input--plain',
    // A text field with a numeric keyboard, not a number field: a number
    // field has no caret position, so the player's cursor cannot be put
    // back where it was after a redraw.
    attrs: {
      type: 'text',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      id: 'stat-value',
      placeholder: '50',
      value: String(thresholdValue),
    },
    on: {
      input: (e) => {
        const value = Number(e.currentTarget.value);
        if (Number.isFinite(value)) onPick({ id: 'stat' }, { metric: statMetric, op: '>=', value });
      },
    },
  });

  const suggestionEl = suggestion
    ? el('p', { className: 'muted-note', attrs: { id: 'stat-suggestion' } }, [
      `Only ${typedCount} players hit ${thresholdValue}+ ${metricLabel(statMetric)} - try ${suggestion.value}+`,
      el('button', {
        className: 'btn btn--tiny',
        text: `Use ${suggestion.value}+`,
        attrs: { type: 'button' },
        on: {
          click: (e) => {
            e.preventDefault();
            onPick({ id: 'stat' }, { metric: statMetric, op: '>=', value: suggestion.value });
          },
        },
      }),
    ])
    : null;

  const onPick = (move, value) => {
    const next = applyMove(vibe, move.id, value, players, registry);
    vibe = { ...vibe, clauses: next.clauses };
    // Setting the scope redraws the screen. Redrawing it here as well
    // would take the focus away from the field the player is typing in.
    store.setScope({ id: vibe.id, name: vibe.name, icon: vibe.icon, clauses: vibe.clauses });
  };

  const nameInput = el('input', {
    className: 'input input--plain',
    attrs: { type: 'text', id: 'vibe-name', placeholder: 'Name this vibe', value: vibe.name ?? '' },
    on: {
      change: (e) => {
        // The name the player gives the vibe is the name the room will
        // announce.
        vibe = { ...vibe, name: e.currentTarget.value.trim() || vibe.name };
        store.setScope({ id: vibe.id, name: vibe.name, icon: vibe.icon, clauses: vibe.clauses });
      },
    },
  });

  const save = el('button', {
    className: 'btn btn--primary',
    text: 'Make this ours',
    attrs: { type: 'button', id: 'btn-make-ours' },
    on: {
      click: () => {
        // A vibe with too few players cannot be played, so it is not
        // saved. The reason is beside the button.
        if (tooSmall) return;
        const name = nameInput.value.trim() || vibe.name || 'Our vibe';
        store.saveVibe({ id: vibe.id, name, icon: vibe.icon, clauses: vibe.clauses });
        location.hash = '#home';
      },
    },
  });
  if (tooSmall) save.setAttribute('disabled', '');

  const children = [
    el('header', { className: 'topbar' }, [
      el('a', { className: 'wordmark', text: '← Back', attrs: { href: '#home' } }),
    ]),
    el('section', { className: 'card vibe-summary' }, [
      el('span', { className: 'vibe-summary__icon', text: vibe.icon || '⚽' }),
      el('div', { className: 'vibe-summary__body' }, [
        el('h1', { className: 'page-title', text: vibe.name || 'Your vibe' }),
        el('p', { className: 'muted-note', text: 'Change it below. The number updates as you go.' }),
      ]),
      el('div', { className: `vibe-summary__count ${tooSmall ? 'is-low' : ''}`, id: 'pool-count' }, [
        el('strong', { text: String(count) }),
        el('span', { text: count === 1 ? 'player' : 'players' }),
      ]),
    ]),
    tooSmall
      ? el('p', { className: 'notice notice--warn', id: 'pool-warning' }, [
          el('strong', {
            text: describeCoverage({
              scope: store.state.scope,
              count,
              floor: MIN_POOL,
              registry: store.state.registry,
            }),
          }),
        ])
      : null,
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Make it yours' }),
      ...MOVES.map((m) => moveRow(vibe, m, options[m.id], players, onPick)),
    ]),
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'A threshold' }),
      el('div', { className: 'threshold-row' }, [
        metricSelect,
        el('label', {
          className: 'threshold-label',
          text: 'At least',
          attrs: { for: 'stat-value' },
        }),
        thresholdInput,
      ]),
      suggestionEl,
    ]),
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Save it' }),
      nameInput,
      save,
      tooSmall
        ? el('p', { className: 'muted-note', attrs: { id: 'save-reason' } },
          `Not saved: ${describeCoverage({
            scope: store.state.scope,
            count,
            floor: MIN_POOL,
            registry: store.state.registry,
          })}`)
        : null,
      el('button', {
        className: 'btn btn--ghost',
        text: 'Share this vibe',
        attrs: { type: 'button', id: 'btn-share' },
        on: {
          click: async (e) => {
            const button = e.currentTarget;
            const link = shareLink(store.state.scope ?? vibe);
            button.dataset.link = link;
            try {
              await navigator.clipboard.writeText(link);
              button.textContent = 'Link copied';
            } catch {
              button.textContent = link;
            }
          },
        },
      }),
    ]),
    el('div', { className: 'vibe-actions' }, [
      el('button', {
        className: 'btn btn--primary',
        text: 'Create a room',
        attrs: { type: 'button', id: 'btn-create-room' },
        on: {
          click: async (e) => {
            const button = e.currentTarget;
            button.disabled = true;
            button.textContent = 'Creating…';
            const created = await room.create({ scope: vibe });
            if (created) {
              location.hash = '#room-lobby';
            } else {
              button.disabled = false;
              button.textContent = 'Create a room';
            }
          },
        },
      }),
      el('a', {
        className: 'btn btn--ghost',
        text: 'Play solo',
        attrs: { href: '#lobby' },
      }),
      // The room's own state, so the reason a room did not come is shown
      // rather than swallowed.
      el('p', { className: 'muted-note', attrs: { id: 'vibe-error' } }, room.state.error ?? ''),
    ]),
  ];

  mount(root, children.filter(Boolean));
}
