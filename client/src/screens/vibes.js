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
  const typedCount = scopePool({
    clauses: [{ stats: [{ metric: statMetric, op: '>=', value: thresholdValue }] }],
  }, players).length;
  const suggestion = typedCount < MIN_POOL
    ? nearestThreshold({
      scope: { clauses: [{ stats: [{ metric: statMetric, op: '>=', value: thresholdValue }] }] },
      metric: statMetric,
      players,
      floor: MIN_POOL,
      max: 1000,
    })
    : null;

  // The suggestion only exists when there is one.
  const suggestionEl = suggestion
    ? el('p', { className: 'muted-note', attrs: { id: 'stat-suggestion' } }, [
      `Only ${suggestion.count} players hit ${thresholdValue}+ ${metricLabel(statMetric)} - try ${suggestion.value}+`,
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
    store.setScope({ id: vibe.id, name: vibe.name, icon: vibe.icon, clauses: vibe.clauses });
    rerender();
  };

  const nameInput = el('input', {
    className: 'input',
    attrs: { type: 'text', id: 'vibe-name', placeholder: 'Name this vibe', value: vibe.name ?? '' },
  });

  const save = el('button', {
    className: 'btn btn--primary',
    text: 'Make this ours',
    attrs: { type: 'button', id: 'btn-make-ours' },
    on: {
      click: () => {
        const name = nameInput.value.trim() || vibe.name || 'Our vibe';
        store.saveVibe({ id: vibe.id, name, icon: vibe.icon, clauses: vibe.clauses });
        location.hash = '#home';
      },
    },
  });

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
          el('strong', { text: `Only ${count} players fit that. ` }),
          el('span', { text: 'A vibe needs at least 20 players to write a quiz from.' }),
        ])
      : null,
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Make it yours' }),
      ...MOVES.map((m) => moveRow(vibe, m, options[m.id], players, onPick)),
    ]),
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'A threshold' }),
      el('div', { className: 'threshold-row' }, [
        el('select', { className: 'text-input', attrs: { id: 'stat-metric' } },
          STAT_METRICS.map((m) => el('option', { text: m.label, attrs: { value: m.id } }))),
        el('input', {
          className: 'text-input',
          attrs: { type: 'number', id: 'stat-value', min: '0', placeholder: '50', value: String(thresholdValue) },
          on: {
            input: (e) => {
              const value = Number(e.currentTarget.value);
              if (Number.isFinite(value)) onPick({ id: 'stat' }, { metric: statMetric, op: '>=', value });
            },
          },
        }),
      ]),
      suggestionEl,
    ]),
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Save it' }),
      nameInput,
      save,
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
    ]),
  ];

  mount(root, children.filter(Boolean));
}
