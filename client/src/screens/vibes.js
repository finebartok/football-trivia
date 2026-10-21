import { el, mount } from '../ui.js';
import { store } from '../store.js';
import { room } from '../room.js';
import { PRESETS, countFor } from '../pool.js';

const MIN_POOL = 20;

/** The named moves a player can make to a vibe. Each is one sentence, not a query. */
const MOVES = [
  { id: 'era', label: 'Different era' },
  { id: 'competition', label: 'Different competition' },
  { id: 'club', label: 'Add a club' },
  { id: 'nation', label: 'Only these nations' },
  { id: 'stat', label: 'A narrower stat' },
];

function erasFor(players) {
  const set = new Set();
  for (const p of players) {
    for (const t of p.teams ?? []) {
      for (const s of t.seasons ?? []) set.add(s);
    }
  }
  const years = [...set].sort((a, b) => a - b);
  if (!years.length) return [];
  const min = years[0];
  const max = years[years.length - 1];
  const eras = [];
  for (let start = min; start + 9 <= max; start += 5) {
    eras.push({ start, end: start + 9, label: `${start}–${String(start + 9).slice(2)}` });
  }
  if (!eras.length) eras.push({ start: min, end: max, label: `${min}–${max}` });
  return eras;
}

function competitionsFor(registry, players) {
  const counts = new Map();
  for (const p of players) {
    for (const t of p.teams ?? []) {
      if (!t.leagueId) continue;
      counts.set(t.leagueId, (counts.get(t.leagueId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => ({
      id,
      name: registry?.leagues?.[id] ?? id,
      players: n,
    }));
}

function clubsFor(players) {
  const counts = new Map();
  for (const p of players) {
    for (const t of p.teams ?? []) {
      if (!t.clubId) continue;
      counts.set(t.clubId, (counts.get(t.clubId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([id, n]) => ({ id, name: countName(players, id), players: n }));
}

function countName(players, clubId) {
  for (const p of players) {
    for (const t of p.teams ?? []) {
      if (t.clubId === clubId) return t.clubName;
    }
  }
  return `Club ${clubId}`;
}

function nationsFor(players) {
  const counts = new Map();
  for (const p of players) {
    for (const c of p.citizenship ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, name: id, players: n }));
}

const STAT_MOVES = [
  { id: 'goals_after_age_30', label: '50+ goals aged 30+', op: '>=', value: 50 },
  { id: 'goals_after_age_30', label: '30+ goals aged 30+', op: '>=', value: 30 },
  { id: 'international_caps', label: '50+ international caps', op: '>=', value: 50 },
  { id: 'international_caps', label: '100+ international caps', op: '>=', value: 100 },
  { id: 'club_goals', label: '100+ goals since 2012', op: '>=', value: 100 },
];

/** Apply a move to a vibe's clauses, returning a NEW vibe. Never mutates. */
export function applyMove(vibe, move, value, players, registry) {
  const clauses = vibe.clauses.map((c) => ({ ...c }));
  switch (move) {
    case 'era': {
      const era = value;
      for (const c of clauses) {
        c.seasonStart = era.start;
        c.seasonEnd = era.end;
      }
      return { ...vibe, clauses, label: `era ${era.label}` };
    }
    case 'competition': {
      for (const c of clauses) {
        c.leagues = [value.id];
        delete c.tournaments;
        delete c.stats;
      }
      return { ...vibe, clauses, label: value.name };
    }
    case 'club': {
      const ids = clauses.flatMap((c) => c.teams ?? []);
      if (!ids.includes(value.id)) ids.push(value.id);
      for (const c of clauses) {
        c.teams = ids;
        delete c.leagues;
        delete c.tournaments;
        delete c.stats;
      }
      return { ...vibe, clauses, label: value.name };
    }
    case 'nation': {
      const ids = clauses.flatMap((c) => c.nationalities ?? []);
      if (!ids.includes(value.id)) ids.push(value.id);
      for (const c of clauses) {
        c.nationalities = ids;
        delete c.leagues;
        delete c.tournaments;
        delete c.stats;
      }
      return { ...vibe, clauses, label: value.name };
    }
    case 'stat': {
      const stats = clauses.flatMap((c) => c.stats ?? []);
      const same = stats.find((s) => s.metric === value.id);
      if (same) same.value = value.value;
      else stats.push({ metric: value.id, op: value.op, value: value.value });
      for (const c of clauses) {
        c.stats = stats;
        delete c.leagues;
        delete c.tournaments;
      }
      return { ...vibe, clauses, label: value.label };
    }
    default:
      return vibe;
  }
}

function moveRow(vibe, move, options, players, onPick) {
  if (!options.length) {
    return el('div', { className: 'move move--empty' }, [
      el('span', { className: 'move__label', text: move.label }),
      el('span', { className: 'muted-note', text: 'nothing to change here yet' }),
    ]);
  }
  const select = el('select', {
    className: 'move__select',
    attrs: { 'aria-label': move.label },
    on: {
      change: (e) => {
        const raw = e.target.value;
        const option = options.find((o) => String(o.key) === raw);
        if (option) onPick(move, option.value);
      },
    },
  }, [
    el('option', { text: '—', attrs: { value: '' } }),
    ...options.map((o) => el('option', { text: o.label, attrs: { value: String(o.key) } })),
  ]);

  return el('div', { className: 'move' }, [
    el('label', { className: 'move__label', text: move.label }),
    select,
  ]);
}

export function render(root) {
  // The pool counts and the moves need the player pool.
  store.ensurePool().catch(() => {});
  const players = store.state.pool?.players ?? [];
  const registry = store.state.registry;

  // Start from the saved scope, or the first preset.
  const base = store.state.scope ?? { ...PRESETS[0], clauses: PRESETS[0].clauses };
  let vibe = { id: base.id, name: base.name, icon: base.icon, clauses: base.clauses };

  const count = countFor({ clauses: vibe.clauses });
  const tooSmall = count < MIN_POOL;

  const rerender = () => render(root);

  const options = {
    era: erasFor(players).map((e) => ({ key: `${e.start}-${e.end}`, label: e.label, value: e })),
    competition: competitionsFor(registry, players).map((c) => ({ key: c.id, label: `${c.name} (${c.players})`, value: c })),
    club: clubsFor(players).map((c) => ({ key: c.id, label: `${c.name} (${c.players})`, value: c })),
    nation: nationsFor(players).map((n) => ({ key: n.id, label: `${n.name} (${n.players})`, value: n })),
    stat: STAT_MOVES.map((s) => ({ key: `${s.id}-${s.value}`, label: s.label, value: s })),
  };

  const onPick = (move, value) => {
    const next = applyMove(vibe, move, value, players, registry);
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
      el('h2', { className: 'section-title', text: 'Save it' }),
      nameInput,
      save,
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
            const created = await room.create({ scope: store.state.scope });
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
